import { Avatar } from '@bwo-ui/react';
import { UserRound } from 'lucide-react';

export const AVATARS: Record<string, string> = {
  default:   '/assets/avatars/default.png',
  red_car:   '/assets/avatars/rat.png',
  blue_car:  '/assets/avatars/frog.png',
}
const BOT_AVATAR = '/assets/avatars/bunnybot.png'

export function avatarPath(id: string | null | undefined): string {
  if (id === 'bot') return BOT_AVATAR
  if (!id) return AVATARS.default
  return AVATARS[id] ?? AVATARS.default
}

type Props = {
  avatarId?: string | null
}

const PlayerAvatar = ({ avatarId }: Props) => {
  return (
    <Avatar
      shape="rounded"
      size="lg"
      src={avatarPath(avatarId)}
      fallback={<UserRound className="stroke-neon-cyan w-[2.5em] h-[2.5em]"/>}
      style={{
        width: 'clamp(24px, 3vw, 60px)',
        height: 'clamp(24px, 3vw, 60px)',
        background: 'var(--gamify-bg-cyber)'
    }}/>
  )
}

export default PlayerAvatar
