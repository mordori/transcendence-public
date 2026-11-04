import { CyberpunkCard } from "@/components/ui/cyberpunk-card";
import { Crown } from 'lucide-react';
import PlayerAvatar from '@/components/PlayerAvatar'

export type Player = { username: string; avatarId: string | null; reserved?: boolean }
export type SlotId = 'blue-1' | 'blue-2' | 'blue-3' | 'red-1' | 'red-2' | 'red-3'

type SlotProps = {
  slotId: SlotId
  player: Player | null
  onClick: () => void
}

export function Slot({ slotId, player, onClick }: SlotProps) {
  const team = slotId.startsWith('blue') ? 'blue' : 'red'
  const isEmpty = !player
  const isOwner = slotId === 'blue-1' && !isEmpty

  return (
    <button className="relative block w-full p-0 border-0 bg-transparent text-left
                  transition-transform duration-150 cursor-pointer hover:scale-[1.02]"
    onClick={onClick}>
      {isEmpty
        ? <EmptySlot />
        : team === 'blue'
          ? <BlueSlot player={player} />
          : <RedSlot player={player} />}

      {isOwner && (
        <span
          className="absolute top-2 right-4 flex items-center rounded px-2 py-0.5
            text-[clamp(8px,0.8vw,14px)] text-yellow-300 bg-black/60 border border-yellow-400/60"
          title="Room owner"
        >
          <Crown className="w-[1em] h-[1em]" />
        </span>
      )}
    </button>
  )
}

// Separate looks of 3 versions of a slot
function EmptySlot() {
  return (
    <CyberpunkCard
      theme="custom"
      customColors={{
        primary: "#c0c0c0",
        secondary: "#808080",
        accent: "#565555",
      }}
      borderStyle="solid"
      animationSpeed="fast"
      glow={false}
      lightTrail={false}
    >
      <div className="w-[clamp(100px,15vw,500px)] h-[clamp(10px,3vh,200px)] flex items-center text-zinc-500 text-[clamp(10px,1vw,30px)]">
        Empty
      </div>
    </CyberpunkCard>
  );
}

function BlueSlot({ player }: { player: Player }) {
  return (
    <CyberpunkCard
      theme="neon-blue"
      borderStyle="corners"
      glow={false}
      lightTrail={false}
      loading={!!player.reserved}
    >
      <div className="w-[clamp(100px,15vw,500px)] h-[clamp(10px,3vh,200px)] flex items-center gap-2 text-zinc-700 text-[clamp(10px,1vw,30px)]">
        <PlayerAvatar avatarId={player.avatarId}/>
        {player.username}
      </div>
    </CyberpunkCard>
  )
}

function RedSlot({ player }: { player: Player }) {
  return (
    <CyberpunkCard
      theme="neon-red"
      borderStyle="corners"
      glow={false}
      lightTrail={false}
      loading={!!player.reserved}
    >
      <div className="w-[clamp(100px,15vw,500px)] h-[clamp(10px,3vh,200px)] gap-2 flex items-center text-zinc-100 text-[clamp(10px,1vw,30px)]">
        <PlayerAvatar avatarId={player.avatarId}/>
        {player.username}
      </div>
    </CyberpunkCard>
  )
}