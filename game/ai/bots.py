import asyncio
import glob
import json
import os
import sys
from urllib.parse import urlencode

import numpy as np
import torch
import websockets
from rlgym_ppo.ppo import DiscreteFF
from websockets.exceptions import ConnectionClosed, InvalidHandshake

sys.path.append(
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "sim", "python")
    )
)

from transcendence.action import LOOKUP_TABLE
from transcendence.obs import DefaultObs, OBS_SIZE
from transcendence.common_values import ACTION_REPEAT
from transcendence.state import GameState


BOT_TOKEN = os.environ.get("GAME_BOT_TOKEN")

if not BOT_TOKEN:
    raise RuntimeError("GAME_BOT_TOKEN must be set for the AI controller")

SERVER_URL = "ws://game-server:9001"
RETRY_DELAY = 3.0

POLICY_PATH = os.environ["POLICY_PATH"]
DETERMINISTIC = os.environ["BOT_DETERMINISTIC"] == "1"

if not os.path.isfile(POLICY_PATH):
    raise FileNotFoundError(f"Policy does not exist: {POLICY_PATH}")

policy = DiscreteFF(
    OBS_SIZE,
    len(LOOKUP_TABLE),
    (2048, 2048, 1024, 1024),
    device="cpu",
)
policy.load_state_dict(
    torch.load(POLICY_PATH, map_location="cpu", weights_only=True)
)
policy.eval()

print(f"Loaded policy: {POLICY_PATH}", flush=True)
print(f"Deterministic inference: {DETERMINISTIC}", flush=True)

obs_builder = DefaultObs()

def predict_actions(observations):
    batch = np.asarray(observations, dtype=np.float32)
    if batch.ndim != 2 or batch.shape[1] != OBS_SIZE:
        raise ValueError("Invalid observation shape")
    if not np.isfinite(batch).all():
        raise ValueError("Non-finite observation values")

    tensor = torch.as_tensor(batch, dtype=torch.float32)
    with torch.inference_mode():
        if DETERMINISTIC:
            indices = policy.get_output(tensor).argmax(dim=-1)
        else:
            indices, _ = policy.get_action(tensor)

    indices = np.asarray(indices.cpu(), dtype=np.int64).reshape(-1)
    if len(indices) != len(batch):
        raise ValueError("Policy returned the wrong action count")
    if ((indices < 0) | (indices >= len(LOOKUP_TABLE))).any():
        raise ValueError("Policy returned an invalid action")

    return indices.tolist()

def build_flat_array(sorted_players, data, touched_ids=()):
    arr = np.zeros(13 + 16 * len(sorted_players), dtype=np.float32)
    arr[0] = len(sorted_players)

    ball = data["balls"][0]
    arr[1:4] = ball["pos"]
    arr[4:7] = ball.get("linVel", [0, 0, 0])
    arr[7:10] = ball.get("angVel", [0, 0, 0])

    for i, player in enumerate(sorted_players):
        offset = 13 + i * 16
        arr[offset] = player["team"]
        arr[offset + 1:offset + 4] = player["pos"]

        w, x, y, z = player["rot"]
        arr[offset + 4:offset + 8] = [x, y, z, w]

        arr[offset + 8:offset + 11] = player.get("linVel", [0, 0, 0])
        arr[offset + 11:offset + 14] = player.get("angVel", [0, 0, 0])
        arr[offset + 14] = float(player.get("isGrounded", True))
        arr[offset + 15] = float(player["id"] in touched_ids)

    return arr


def handshake_status(error):
    # Support newer and older websockets exception layouts.
    response = getattr(error, "response", None)
    return getattr(
        response,
        "status_code",
        getattr(error, "status_code", None),
    )


async def run_bot_session(room):
    query = urlencode({"room": room, "role": "bot", "token": BOT_TOKEN})
    uri = f"{SERVER_URL}/game?{query}"
    print(f"[AI ROOM] Connecting to '{room}'...", flush=True)

    async with websockets.connect(
        uri, ping_interval=None, open_timeout=10, close_timeout=2
    ) as websocket:
        last_actions = {}
        previous_roster = None
        last_decision_tick = None
        last_touch_counts = {}
        pending_touches = set()

        async for message in websocket:
            latest = None

            # Touch counters survive dropped/coalesced snapshots.
            while True:
                data = json.loads(message)
                if data.get("type") == "welcome":
                    print(f"[AI ROOM] Connected to '{room}'", flush=True)
                elif data.get("type") == "error":
                    print(
                        f"[AI ROOM] Server reported an error in '{room}'",
                        flush=True,
                    )
                elif "players" in data:
                    latest = data

                try:
                    message = await asyncio.wait_for(
                        websocket.recv(), timeout=0.001
                    )
                except asyncio.TimeoutError:
                    break

            if latest is None:
                continue

            players = sorted(
                (p for p in latest["players"] if p.get("isActive", True)),
                key=lambda p: (p["team"], p["slot"]),
            )
            roster = tuple(
                (p["team"], p["slot"], p["id"], p.get("isBot", False))
                for p in players
            )
            roster_changed = roster != previous_roster

            if roster_changed:
                print(f"[AI ROSTER: {room}] {roster}", flush=True)
                previous_roster = roster

            active_ids = {p["id"] for p in players}
            pending_touches.intersection_update(active_ids)
            current_counts = {}

            for p in players:
                count = int(p["ballTouchCount"])
                previous = last_touch_counts.get(p["id"])
                if previous is not None and count != previous:
                    pending_touches.add(p["id"])
                current_counts[p["id"]] = count

            last_touch_counts = current_counts

            bot_agent_ids = []
            bot_net_ids = []
            team_indices = {0: 0, 1: 0}

            for p in players:
                team = int(p["team"])
                if team not in team_indices:
                    raise ValueError("Unknown team ID")

                name = "blue" if team == 1 else "orange"
                agent_id = f"{name}_{team_indices[team]}"
                team_indices[team] += 1

                if p.get("isBot", False):
                    bot_agent_ids.append(agent_id)
                    bot_net_ids.append(p["id"])

            if not bot_net_ids:
                last_actions.clear()
                pending_touches.clear()
                last_decision_tick = None
                continue

            tick = int(latest["physicsTick"])
            playing = latest.get("matchState") == "ONGOING"

            if not playing or not latest.get("balls"):
                last_actions = {
                    net_id: LOOKUP_TABLE[0] for net_id in bot_net_ids
                }
                pending_touches.clear()
                last_decision_tick = None
            else:
                elapsed = (
                    0 if last_decision_tick is None
                    else (tick - last_decision_tick) & 0xFFFFFFFF
                )
                need_action = (
                    last_decision_tick is None
                    or elapsed >= ACTION_REPEAT
                    or roster_changed
                    or set(last_actions) != set(bot_net_ids)
                )

                if need_action:
                    raw = build_flat_array(
                        players, latest, pending_touches
                    )
                    state = GameState(raw)
                    observations = [
                        obs_builder._build(state, agent_id)
                        for agent_id in bot_agent_ids
                    ]
                    indices = predict_actions(observations)

                    last_actions = {
                        net_id: LOOKUP_TABLE[index]
                        for net_id, index in zip(bot_net_ids, indices)
                    }
                    pending_touches.clear()
                    last_decision_tick = tick

            payload = {
                "type": "bot_input",
                "botInputs": [
                    {
                        "id": net_id,
                        "input": dict(zip(
                            ("up", "down", "left", "right", "jump"),
                            (bool(x) for x in last_actions[net_id]),
                        )),
                    }
                    for net_id in bot_net_ids
                ],
            }
            await websocket.send(
                json.dumps(payload, separators=(",", ":"))
            )


async def run_room(room, instance):
    """Control one announced room until cancelled or explicitly closed."""
    try:
        while True:
            try:
                await run_bot_session(room)

            except ConnectionClosed as error:
                code = (
                    error.rcvd.code
                    if error.rcvd is not None
                    else None
                )

                if code == 4003:
                    print(
                        f"[AI ROOM] '{room}' instance={instance} closed. "
                        "No reconnect.",
                        flush=True,
                    )
                    return

                if code == 4001:
                    print(
                        f"[AI ROOM] Authentication rejected for '{room}'. "
                        "Check GAME_BOT_TOKEN.",
                        flush=True,
                    )
                    return

                print(
                    f"[AI ROOM] '{room}' disconnected: code={code}",
                    flush=True,
                )

            except InvalidHandshake as error:
                status = handshake_status(error)

                if status in (401, 403):
                    print(
                        f"[AI ROOM] Authentication rejected for '{room}'.",
                        flush=True,
                    )
                    return

                print(
                    f"[AI ROOM] '{room}' handshake failed: HTTP {status}",
                    flush=True,
                )

            except (OSError, asyncio.TimeoutError):
                print(
                    f"[AI ROOM] Could not connect to '{room}'.",
                    flush=True,
                )

            else:
                print(
                    f"[AI ROOM] '{room}' connection ended.",
                    flush=True,
                )

            # Retry temporary failures only while discovery still
            # lists this room. Removal cancels the task and this sleep.
            print(
                f"[AI ROOM] Retrying '{room}' in {RETRY_DELAY:g} seconds...",
                flush=True,
            )
            await asyncio.sleep(RETRY_DELAY)

    except asyncio.CancelledError:
        print(
            f"[AI ROOM] Stopped '{room}' instance={instance}",
            flush=True,
        )
        raise

    except Exception as error:
        # Avoid printing exception contents that could contain a URL/token.
        print(
            f"[AI ROOM] '{room}' stopped unexpectedly: "
            f"{type(error).__name__}",
            flush=True,
        )
        raise


async def cancel_room_tasks(room_tasks):
    tasks = [task for _, task in room_tasks.values()]
    room_tasks.clear()

    for task in tasks:
        task.cancel()

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


def report_room_task(task):
    # run_room logs unexpected failures. Retrieve the exception here
    # so it doesn't become an unobserved task exception.
    if not task.cancelled():
        task.exception()


async def apply_room_directory(room_tasks, entries):
    wanted = {
        entry["room"]: int(entry["instance"])
        for entry in entries
    }

    stopped = []

    # Cancel closed rooms and old instances of recreated rooms.
    for room, (instance, task) in list(room_tasks.items()):
        if wanted.get(room) != instance:
            del room_tasks[room]
            task.cancel()
            stopped.append(task)

    if stopped:
        await asyncio.gather(*stopped, return_exceptions=True)

    # Start newly announced room instances.
    for room, instance in wanted.items():
        if room in room_tasks:
            continue

        print(
            f"[AI ROOM] Starting '{room}' instance={instance}",
            flush=True,
        )

        task = asyncio.create_task(run_room(room, instance))
        task.add_done_callback(report_room_task)
        room_tasks[room] = (instance, task)

    # Completed tasks remain registered until their room instance
    # changes or disappears. In particular, a 4003 must not cause
    # the same closed room to restart on another directory update.


async def run_bot():
    query = urlencode({"token": BOT_TOKEN})
    uri = f"{SERVER_URL}/bot-service?{query}"

    while True:
        room_tasks = {}

        try:
            print("[AI SERVICE] Connecting...", flush=True)

            async with websockets.connect(
                uri,
                ping_interval=10,
                ping_timeout=10,
                open_timeout=10,
                close_timeout=2,
            ) as service:
                print(
                    "[AI SERVICE] Connected. Waiting for room directory.",
                    flush=True,
                )

                # Keep this connection open even with zero rooms.
                # Process every directory update in order.
                async for message in service:
                    data = json.loads(message)

                    if data.get("type") != "bot_rooms":
                        continue

                    entries = data["rooms"]
                    await apply_room_directory(room_tasks, entries)

                    print(
                        f"[AI SERVICE] Available rooms: {len(entries)}",
                        flush=True,
                    )

        except ConnectionClosed as error:
            code = (
                error.rcvd.code
                if error.rcvd is not None
                else None
            )

            if code == 4002:
                print(
                    "[AI SERVICE] Replaced by another bot service. "
                    "Stopping this instance.",
                    flush=True,
                )
                return

            if code == 4001:
                print(
                    "[AI SERVICE] Authentication rejected. "
                    "Check GAME_BOT_TOKEN.",
                    flush=True,
                )
                raise SystemExit(1)

            print(
                f"[AI SERVICE] Connection lost: code={code}",
                flush=True,
            )

        except InvalidHandshake as error:
            status = handshake_status(error)

            if status in (401, 403):
                print(
                    "[AI SERVICE] Authentication rejected. "
                    "Check GAME_BOT_TOKEN.",
                    flush=True,
                )
                raise SystemExit(1)

            print(
                f"[AI SERVICE] Handshake failed: HTTP {status}",
                flush=True,
            )

        except (OSError, asyncio.TimeoutError):
            print(
                "[AI SERVICE] Server unavailable.",
                flush=True,
            )

        finally:
            # Without discovery, stop using the old room directory.
            # Reconnection supplies a fresh authoritative list.
            await cancel_room_tasks(room_tasks)

        print(
            f"[AI SERVICE] Reconnecting in {RETRY_DELAY:g} seconds...",
            flush=True,
        )
        await asyncio.sleep(RETRY_DELAY)


if __name__ == "__main__":
    asyncio.run(run_bot())
