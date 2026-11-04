import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRoomList, createRoom, joinRoom } from '@/lib/room-api'
import CreateRoom from '@/components/CreateRoom'
// @ts-ignore
import { GamifyCard, GamifyButton, GamifyInput, GamifySpinner, GamifyBadge } from '@sitharaj08/gamify'
import { CyberpunkCard } from "@/components/ui/cyberpunk-card";
import { UserRound } from 'lucide-react';

type Room = {
  id: string
  name: string
  locked: boolean
  playerCount: number
}

const StartGame = () => {
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [roomPassword, setRoomPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  {/* 
    Fetch room list every 5s
    - Refresh list immediately when the tab becomes visible (from switching tabs, lock screen,...)
    - Stop timer if navigate away from the page
  */}
  useEffect(() => {
    let stopFetch = false
    let firstLoad = true

    const loadRooms = async () => {
      try {
        const nextRooms = await getRoomList()
        if (!stopFetch) {
          setRooms(nextRooms)
          setListError(null)
        }
      } catch (err) {
        if (!stopFetch && firstLoad) {
          setListError(err instanceof Error ? err.message : 'Could not load rooms')
        }
      } finally {
        if (firstLoad && !stopFetch) {
          setListLoading(false)
          firstLoad = false
        }
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadRooms()
    }

    setListError(null)
    void loadRooms()
    const timer = window.setInterval(() => void loadRooms(), 5000)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stopFetch = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const handleCreate = async (roomName: string, password: string | null) => {
    const room = await createRoom(roomName, password)
    setShowCreate(false)
    const params = new URLSearchParams({ name: room.name, id: room.id })
    navigate(`/lobby?${params.toString()}`, { state: { isNewRoom: true } })
  }

  const handleJoin = async (room: Room, password: string | null) => {
    const joined = await joinRoom(room.id, password)
    const params = new URLSearchParams({ name: joined.name, id: joined.id })
    navigate(`/lobby?${params.toString()}`)
  }

  const handleRoomClick = async (room: Room) => {
    // Close selected room (only works for rooms with password)
    if (selectedRoom?.id === room.id) {
      setSelectedRoom(null)
      setRoomPassword('')
      return
    }

    setError(null)
    setRoomPassword('')

    // Public room: join immediately
    if (!room.locked) {
      setLoading(true)
      try {
        await handleJoin(room, null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not join room :(')
        setLoading(false)
        setSelectedRoom(null)
      }
      return
    }

    // Locked room: select it and wait for password
    setSelectedRoom(room)
  }

  const handleSubmitPassword = async () => {
    if (!selectedRoom) return
    setError(null)

    if (roomPassword.length < 3) {
      setError('Password must be at least 3 characters')
      return
    }

    setLoading(true)
    try {
      await handleJoin(selectedRoom, roomPassword)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join room :(')
      setLoading(false)
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a14] 
                  bg-[radial-gradient(ellipse_60%_50%_at_40%_20%,rgba(236,72,72,0.25),transparent_40%),radial-gradient(ellipse_60%_50%_at_70%_80%,rgba(6,44,212,0.25),transparent_40%),radial-gradient(circle_at_center,#292937_0%,#0a0a14_100%)]"> 

      {/* Header aligned to the left */}
      <div className="HEADER flex flex-col items-center w-full max-w-[2500px] gap-[clamp(0px,1.5vh,50px)]">
        <h1 className="self-start mt-0 mr-0 mb-[clamp(16px,3vh,40px)] ml-[clamp(24px,8vw,120px)] text-[clamp(32px,4.8vw,84px)] tracking-[0.1em] text-neon-cyan font-heading font-bold">
          Room List
        </h1>
      </div>

      <GamifyCard variant="common" style={{
        padding: 'clamp(10px, 3vw, 80px)',
        background: 'rgba(0, 0, 0, 0.4)',
        borderColor: 'var(--gamify-neon-cyan)',
        position: 'relative',
        width: 'clamp(320px, 60vw, 1600px)',
        height: 'clamp(240px, 50vh, 1000px)',
        textAlign: 'center',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'clamp(0px, 1.5vh, 30px)'
      }}>

        {error && (
          <div className="ERROR text-[#ff4d4d] bg-[#ff4d4d]/10 border border-[#ff4d4d]/30 rounded-md px-[clamp(8px,1.2vh,20px)] text-center text-[clamp(13px,1.2vw,15px)]">
            {error}
          </div>
        )}
        
        <div className="ROOM_LIST w-[70%] flex flex-col gap-[clamp(6px,1vw,32px)] items-stretch text-left overflow-y-auto flex-1 min-h-0"> 
          {listLoading && (
            <div className="flex justify-center py-8">
              <GamifySpinner size="lg" />
            </div>
          )}

          {!listLoading && listError && (
            <div className="text-[#ff4d4d] text-center">{listError}</div>
          )}

          {!listLoading && !listError && rooms.length === 0 && (
            <div className="text-center opacity-70">
              No active room available
            </div>
          )}

          {!listLoading && !listError && rooms.map((room) => {
            const isSelected = selectedRoom?.id === room.id
            return (
              <div key={room.id} style={{ flexShrink: 0 }}>
                <CyberpunkCard
                  theme="neon-cyan"
                  borderStyle="corners"
                  lightTrail={false}
                  onClick={() => handleRoomClick(room)}
                >
                  <div className="ROOM_INFO h-[clamp(50px, 8vh, 110px)] flex items-center justify-between text-[clamp(10px, 1vw, 30px)]">
                    <div className="NAME flex items-center gap-[clamp(1px,1vw,20px)] min-w-0">
                      {room.name}
                      {room.locked && (
                        <GamifyBadge variant="legendary" style={{ marginLeft: 'clamp(1px, 1vw, 20px)', fontSize: 'clamp(4px, 0.5vw, 16px)' }}>
                          private
                        </GamifyBadge>
                      )}
                    </div>
                    <span className="PLAYER_COUNT opacity-60 flex gap-[clamp(1px,0.2vw,20px)]">
                      <UserRound/>
                      {room.playerCount}
                    </span>
                  </div>
                </CyberpunkCard>

                {/* Password prompt appears only under the selected locked room */}
                {isSelected && room.locked && (
                  <div className="flex gap-2 items-center mt-2 px-[clamp(4px,0.5vw,12px)]">
                    <GamifyInput
                      type="password"
                      placeholder="Enter room password"
                      value={roomPassword}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setRoomPassword(e.target.value)
                      }
                      onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === 'Enter') handleSubmitPassword()
                      }}
                      autoFocus
                    />
                    <GamifyButton
                      variant="primary"
                      size="sm"
                      onClick={handleSubmitPassword}
                      disabled={loading}
                    >
                      Enter
                    </GamifyButton>
                  </div>
                )}
              </div>
            )
          })}

        </div>

        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-black/60">
            <GamifySpinner size="lg" />
          </div>
        )}
      </GamifyCard>
      
      <div className="BUTTONS flex gap-[clamp(16px,5vw,200px)] p-[clamp(0px,1.5vh,30px)] justify-center my-[clamp(8px,5vh,80px)] mx-auto">
        <GamifyButton variant="outline" size="lg" style={{width: 'clamp(120px, 15vw, 240px)'}}
          onClick={() => navigate('/main-menu')}>
          Back
        </GamifyButton>
        <GamifyButton variant="legendary" size="lg" onClick={() => setShowCreate(true)}>
          New room
        </GamifyButton>
      </div>

      <CreateRoom
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
      />

    </div>
  )
}

export default StartGame