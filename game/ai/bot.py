import asyncio
import json
import torch
import numpy as np
import websockets
import sys
import os
from rlgym_ppo.ppo import DiscreteFF
# Ensure we can import your gym environment code
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sim', 'python')))

from transcendence.obs import DefaultObs
from transcendence.action import LookupTableAction, LOOKUP_TABLE
from transcendence.state import GameState

# 1. Load the policy
# (Adjust this path to point exactly to where your trained .pt file is)
POLICY_PATH = "/home/dohanix/Aalto/transcendence/data/checkpoints/rlgym-ppo-run-1789722039360244149/62901961/PPO_POLICY.pt"
try:
    # We must recreate the Neural Network shape exactly as it was in train.py!
    # 28 is the observation size, 13 is the action size.
    policy = DiscreteFF(108, 13, (2048, 2048, 1024, 1024), device="cpu")
    
    # Now we pour the saved weights into the empty network
    state_dict = torch.load(POLICY_PATH, map_location="cpu")
    policy.load_state_dict(state_dict)
    policy.eval()
    
except Exception as e:
    print(f"Could not load policy at {POLICY_PATH}. Error: {e}")
    sys.exit(1)

obs_builder = DefaultObs()
action_parser = LookupTableAction()

def build_flat_array(data):
    """Converts the C++ JSON snapshot into the raw float array GameState expects."""
    num_cars = len(data.get("players", []))
    arr = np.zeros(13 + 16 * num_cars, dtype=np.float32)
    
    arr[0] = num_cars
    
    if data.get("balls"):
        ball = data["balls"][0]
        arr[1:4] = ball["pos"]
        arr[4:7] = ball["linVel"]
        arr[7:10] = ball["angVel"]
    
    for i, p in enumerate(data.get("players", [])):
        offset = 13 + i * 16
        arr[offset + 0] = p["team"]
        arr[offset + 1:offset + 4] = p["pos"]
        rot = p["rot"]
        arr[offset + 4:offset + 8] = [rot[1], rot[2], rot[3], rot[0]]
        arr[offset + 8:offset + 11] = p["linVel"]
        arr[offset + 11:offset + 14] = p["angVel"]
        arr[offset + 14] = 1.0 if p["isGrounded"] else 0.0
        
    return arr

async def run_bot():
    uri = "ws://localhost:9001/game"
    print(f"Connecting to {uri}...")
    
    async with websockets.connect(uri) as websocket:
        my_id = None

        tick_counter = 0

        last_action_array = None
        
        async for message in websocket:
            data = json.loads(message)
            
            # Handle Server Welcome
            if data.get("type") == "welcome":
                my_id = data["id"]
                print(f"Connected successfully! I am Bot ID {my_id}")
                continue
                
            # Handle Game Snapshot
            if "players" not in data or my_id is None:
                continue
                
            # 1. Figure out our string ID (e.g. "blue_0") to match GameState logic
            my_agent_id = None
            blue_idx, orange_idx = 0, 0
            for p in data["players"]:
                is_blue = (p["team"] == 1)
                agent_id = f"blue_{blue_idx}" if is_blue else f"orange_{orange_idx}"
                if p["id"] == my_id:
                    my_agent_id = agent_id
                
                if is_blue: blue_idx += 1
                else: orange_idx += 1
                
            if not my_agent_id:
                continue # We haven't spawned yet
                
            # 2. Build the observation
            flat_array = build_flat_array(data)
            state = GameState(flat_array)
            obs = obs_builder._build(state, my_agent_id)
            
            # 3. Get the action from PyTorch
            if tick_counter % 8 == 0 or last_action_array is None:
                obs_tensor = torch.tensor(obs, dtype=torch.float32).unsqueeze(0)
                with torch.no_grad():
                    action_idx, _ = policy.get_action(obs_tensor)
                last_action_array = LOOKUP_TABLE[action_idx.item()]
            tick_counter += 1
                
            # action_dict = action_parser.parse_actions({my_agent_id: np.array([action_idx.item()])}, state, {})
            # action = action_dict[my_agent_id].tolist()
            
            # 4. Send the button presses back to the C++ server!
            payload = {
                "type": "input",
                "data": {
                    "up": bool(last_action_array[0]),
                    "down": bool(last_action_array[1]),
                    "left": bool(last_action_array[2]),
                    "right": bool(last_action_array[3]),
                    "jump": bool(last_action_array[4])
                }
            }
            await websocket.send(json.dumps(payload))

if __name__ == "__main__":
    asyncio.run(run_bot())