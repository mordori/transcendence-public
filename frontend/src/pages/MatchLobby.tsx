import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { useAuth } from '@/auth/useAuth'
import { requestGameTicket } from '@/lib/room-api'
// @ts-ignore
import { GamifyButton, GamifyCard, GamifyTooltip, GamifySpinner } from '@sitharaj08/gamify';
import { LampHeading } from "@/components/ui/lamp-heading";
import { Eye } from 'lucide-react';
import { Slot, type Player, type SlotId } from '@/components/Slot';
import RoomErrorPage from '@/components/ErrorPage';

// ─── Wire protocol types ───────────────────────────────────────────────────
// Mirror the JSON shape emitted by C++ `Room::Roster::getStatus()`.
// Keep these in sync with components/room.hpp (RoomSeat / RoomStatus).
// `kind` values come from getStatus()
type RoomStatusSeat = {
  team: number
  slot: number
  kind: 'PLAYER' | 'RESERVED' | 'CPU' | 'EMPTY'
  clientId: number
  userId: string
  username: string
  avatarId: string
}
type RoomStatus = {
  type: 'room_status'
  room: string
  state: string
  revision: number
  remaining: number
  scoreBlue: number
  scoreRed: number
  ownerClientId: number
  ownerUserId: string
  spectatorCount: number
  seats: RoomStatusSeat[]
}

const Lobby = () => {
  // ─── Route + auth ────────────────────────────────────────────────────────
  // roomId/roomName come from the URL (?name=...&id=...).
  // isNewRoom is carried via location.state (React Router history entry) — only true for 
  // the user who just created the room, so only they auto-claim blue-1 on WS open.
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const roomName = searchParams.get('name')
  const roomId = searchParams.get('id')
  const location = useLocation()
  const isNewRoom = (location.state as { isNewRoom?: boolean } | null)?.isNewRoom === true
  const { account } = useAuth()

  // ─── Component state ─────────────────────────────────────────────────────
  // connectionStatus: WebSocket lifecycle ('connecting' | 'connected' | 'error').
  // roomStatus: last authoritative roster received from the server. This is
  //   the ONLY source of truth for who sits where — local clicks never
  //   mutate it directly; they only send intents and wait for the next update.
  // socketRef: exposed so handlers outside the effect (slot click, start)
  //   can send messages on the live socket.
  // lastRevisionRef: monotonic counter to drop stale/out-of-order status
  //   broadcasts. Without it, a delayed older message can clobber a newer one.
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const lastRevisionRef = useRef(-1)

  const isOwner = !!roomStatus && !!account && roomStatus.ownerUserId === account.accountId

  // ─── Derived: slot view models ───────────────────────────────────────────
  // Start with all-null slots, then fill from server seats. Rebuilt on every
  // render from roomStatus — not state.
  const slots: Record<SlotId, Player | null> = {
    'blue-1': null, 'blue-2': null, 'blue-3': null,
    'red-1': null, 'red-2': null, 'red-3': null,
  }
  if (roomStatus) {
      for (const seat of roomStatus.seats) {
          if (seat.kind === 'EMPTY') continue
          const slotId = `${seat.team === 0 ? 'blue' : 'red'}-${seat.slot + 1}` as SlotId
          slots[slotId] = {
              username: seat.kind === 'CPU' ? 'BunnyBot' : (seat.username || `Player ${seat.clientId}`),
              avatarId: seat.kind === 'CPU' ? 'bot' : (seat.avatarId || null),
              reserved: seat.kind === 'RESERVED',
          }
      }
  }

  // ─── WebSocket connection lifecycle ──────────────────────────────────────
  // 1. Request a game ticket (sets an HttpOnly cookie the WS upgrade carries).
  // 2. Open the WS to /game?room=<id>.
  // 3. On open, if this is the creator's first visit, auto-claim blue-1.
  // 4. On message, accept only `room_status`, drop stale revisions.
  // 5. Cleanup on unmount / roomId change: mark disposed, close socket.
  useEffect(() => {
    if (!roomId) {
      setConnectionStatus('error')
      setConnectionError('Room ID is missing.')
      return
    }

    let disposed = false
    let socket: WebSocket | null = null
    setConnectionStatus('connecting')
    setConnectionError(null)

    void requestGameTicket(roomId).then(() => {
      if (disposed) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${protocol}//${window.location.host}/game?room=${encodeURIComponent(roomId)}`
      socket = new WebSocket(url)
      const ws = socket
      socketRef.current = socket

      // Incoming frames: accept only room_status, ignore stale revisions.
      ws.addEventListener('message', (event) => {
        if (disposed) return

        let msg: any
        try {
          msg = JSON.parse(event.data as string)
        } catch {
          return
        }

        if (!msg.type) return                     // physics snapshot
        if (msg.type !== 'room_status') return    // other typed messages

        const status = msg as RoomStatus
        if (status.room !== roomId) return
        if (status.revision <= lastRevisionRef.current) return   // stale

        lastRevisionRef.current = status.revision
        setRoomStatus(status)
      })
      // On open: if this browser just created the room, claim blue-1.
      ws.addEventListener('open', () => {
        if (disposed) return
        setConnectionStatus('connected')
        if (isNewRoom) ws.send(JSON.stringify({ type: 'join', team: 0, slot: 0 }))
      })
      ws.addEventListener('error', () => {
        if (!disposed) {
          setConnectionStatus('error')
          setConnectionError('Could not connect to the room server.')
        }
      })
      ws.addEventListener('close', () => {
        if (!disposed) {
          setConnectionStatus('error')
          setConnectionError('Disconnected from the room server.')
        }
      })
    }).catch((error: unknown) => {
      if (disposed) return
      setConnectionStatus('error')
      setConnectionError(error instanceof Error ? error.message : 'Could not connect to the room.')
    })
    return () => {
      disposed = true
      socketRef.current = null
      if (socket?.readyState === WebSocket.OPEN) {
        socket.close(1000, 'Lobby unmount')
      }
    }
  }, [roomId])

  // ─── Slot click handler ──────────────────────────────────────────────────
  // Sends an intent; never mutates `slots` locally. The next room_status
  // broadcast is what actually updates the UI.
  //
  // Owner: empty slot → set_cpu; occupied slot → clear_seat; own blue-1 → no-op.
  // Player: empty slot → join; occupied slot → no-op.
  //
  // Server is authoritative; if it rejects (occupied, not owner, etc.) the
  // UI stays as-is and the user can retry.
  const handleSlotClick = (slotId: SlotId) => {
    const ws = socketRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const occupant = slots[slotId]
    if (occupant?.reserved) return

    const [side, numStr] = slotId.split('-')
    const team = side === 'blue' ? 0 : 1
    const slot = parseInt(numStr, 10) - 1

    if (isOwner) {
      if (slotId === 'blue-1') return   // can't clear yourself
      if (occupant) {
        ws.send(JSON.stringify({ type: 'clear_seat', team, slot }))
      } else {
        ws.send(JSON.stringify({ type: 'set_cpu', team, slot }))
      }
      return
    }

    // Normal player
    if (occupant) return
    ws.send(JSON.stringify({ type: 'join', team, slot }))
  }

  // ─── Leave action ───────────────────────────────────────────────
  // Send a leave message so server knows player actually asks to leave
  // Slot will be freed immediately for another player to claim
  const handleExit = () => {
    const ws = socketRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leave' }))
        ws.close(1000, 'Leaving lobby')
    }
    navigate('/start-game')
  }
  
  // ─── Start action ───────────────────────────────────────────────
  // Sends `{type:'start'}` to the server. This is one click move all players,
  // once the server broadcasts state START.
  //
  // `starting` disables the button + shows a spinner while waiting.
  // The 10s timeout below recovers if the server never confirms.
  const [starting, setStarting] = useState(false)
  const handleStart = () => {
    const ws = socketRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (starting) return
    setStarting(true)
    ws.send(JSON.stringify({ type: 'start' }))
  }

  // Safety net for `starting`: if the server never broadcasts START
  // (rejection, lost message, backend down), re-enable the button after 10s
  useEffect(() => {
      if (!starting) return
      const timer = setTimeout(() => {
          setStarting(false)
          setConnectionError('Start request timed out — try again')
      }, 10_000)
      return () => clearTimeout(timer)
  }, [starting])

  // ─── Start → /battle transition ──────────────────────────────────────────
  // Fires for every client (owner AND non-owner) when the server broadcasts
  // START or ONGOING. The owner's click only sent `{type:'start'}`; the server
  // decides. Each client navigates immediately; the /battle page requests its
  // own ticket before starting the game engine.
  //
  // `shouldNavigate` is derived from state so START → ONGOING doesn't re-fire.
  // `navigatingRef` guards against rapid rerenders and broadcast bursts.
  const navigatingRef = useRef(false)

  const shouldNavigate = roomStatus?.state === 'START' || roomStatus?.state === 'ONGOING'

  useEffect(() => {
    if (!shouldNavigate) return
    if (!roomId) return
    if (navigatingRef.current) return
    navigatingRef.current = true
    setStarting(false)

    const gameParams = new URLSearchParams(searchParams)
    gameParams.set('room', roomId)
    gameParams.delete('id')
    navigate(`/battle?${gameParams.toString()}`)
  }, [shouldNavigate, roomId, searchParams, navigate])

  // ─── Error early return ──────────────────────────────────────────────────
  // Replaces the whole lobby UI when the connection fails.
  if (connectionStatus === 'error') {
    return (
      <RoomErrorPage
        roomName={roomName}
        errorMessage={connectionError}
        onBack={() => navigate('/start-game', { replace: true })}
      />
    )
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a14] 
                    bg-[radial-gradient(ellipse_100%_60%_at_50%_-10%,rgba(139,92,246,0.35),transparent_50%),radial-gradient(ellipse_60%_50%_at_90%_90%,rgba(236,72,153,0.25),transparent_40%),radial-gradient(ellipse_60%_50%_at_10%_80%,rgba(6,182,212,0.25),transparent_40%)]">
      <header className="absolute top-0 flex justify-center pt-[clamp(8px,2vh,30px)]">
        <h1 className="text-[clamp(10px,2vw,120px)] tracking-[0.1em] text-neon-cyan font-heading font-bold">
          Room name: {roomName}
        </h1>
      </header>
      
      <GamifyCard variant="common" style={{
        background: 'rgba(0, 0, 0, 0.4)',
        borderColor: 'var(--gamify-neon-cyan)',
        position: 'relative',
        width: 'clamp(320px, 85vw, 2400px)',
        height: 'clamp(240px, 65vh, 1200px)',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'clamp(2px, 1.5vh, 30px)',
      }}>
      <span className="SPECTATOR flex items-center gap-2 text-[clamp(10px,1.5vw,30px)] text-neon-cyan font-body">
        <Eye /> {roomStatus?.spectatorCount ?? 0}
      </span>

      <div className="TEAMS flex gap-x-[clamp(10px,15vw,800px)]">
        <div className="BLUE w-[clamp(100px,30vw,500px)] h-[clamp(100px,40vh,2000px)]">
          <LampHeading
            text="Team BLUE"
            className="text-blue-700 dark:text-blue-300 items-center"
            direction="above"
            showLightRays={true}
            showParticles={false}
            gradientColors={{
              from: "#0040ff",
              to: "#15338c",
            }}
            lampHeight={40}
            interactive={false}
            pulseEffect={true}
          />
          <div className="SLOTS mt-[3vh] mb-[3vh] grid grid-cols-1 gap-y-[5vh] pb-16"> 
            {(['blue-1', 'blue-2', 'blue-3'] as SlotId[]).map((id) => (
              <Slot
                key={id}
                slotId={id}
                player={slots[id]}
                onClick={() => handleSlotClick(id)}
              />
            ))}
          </div>
        </div>

        <div className="RED w-[clamp(100px,30vw,500px)] h-[clamp(100px,40vh,2000px)]">
          <LampHeading
            text="Team RED"
            className="text-red-700 dark:text-red-300 items-center"
            direction="above"
            showLightRays={true}
            showParticles={false}
            gradientColors={{
              from: "#ff0000",
              to: "#581a07",
            }}
            lampHeight={40}
            interactive={false}
            pulseEffect={true}
          />
          <div className="SLOTS mt-[3vh] mb-[3vh] grid grid-cols-1 gap-y-[5vh] pb-16"> 
            {(['red-1', 'red-2', 'red-3'] as SlotId[]).map((id) => (
              <Slot
                key={id}
                slotId={id}
                player={slots[id]}
                onClick={() => handleSlotClick(id)}
              />
            ))}
          </div>
        </div>
      </div>
      </GamifyCard>
      
      <div className="BUTTONS flex gap-[clamp(16px,5vw,200px)] p-[clamp(0px,1.5vh,30px)]
                      justify-center mt-[clamp(8px,5vh,80px)] mx-auto">
        <GamifyButton variant="outline" size="lg" onClick={ handleExit }>
          Leave
        </GamifyButton>
        {isOwner ? (
          <GamifyButton variant="legendary" size="lg" 
            onClick={handleStart} 
            disabled={starting || connectionStatus !== 'connected'}
            style={{ height: 'clamp(10px, 13.2vh, 64px)', width: 'clamp(10px, 20vw, 180px)' }}
          >
            {starting ? <GamifySpinner size="sm"/> : 'Start'}
          </GamifyButton>
        ) : (
          <GamifyTooltip content="Only room owner can start game">
              <GamifyButton variant="ghost" size="lg" style={{ height: 'clamp(10px, 13.2vh, 64px)', width: 'clamp(10px, 20vw, 180px)' }}>
                Start
              </GamifyButton>
          </GamifyTooltip>
        )}
      </div>
    
    </div>
  )
}

export default Lobby