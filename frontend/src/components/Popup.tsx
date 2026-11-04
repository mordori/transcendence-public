import type { ReactNode } from 'react'
// @ts-ignore
import { GamifyButton, GamifyCard } from '@sitharaj08/gamify';

export type PopupKind = 'tos' | 'priv' | 'cre'

type Props = {
  kind: PopupKind | null
  onClose: () => void
}

const CONTENT: Record<PopupKind, { title: string; body: ReactNode }> = {
  tos: {
    title: 'Terms of Service',
    body: (
      <>
        <p>These Terms of Service ("Terms") govern your access to and use of NOT Rocket League (the "Game"), provided by Bad Boys and Bad Girl ("we," "us," or "our").</p>
        <p>By playing or accessing the Game, you agree to these Terms.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">1. User Accounts</p>
        <p>- You are responsible for maintaining the confidentiality of your account details (username and password).</p>
        <p>- You are responsible for all activities that occur under your account.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">2. Acceptable Use & Conduct</p>
        <p>When using or playing the Game, you agree not to:</p>
        <p className="pl-8">- Cheat, hack, exploit bugs, or use unauthorized third-party software or bots.</p>
        <p className="pl-8">- Disrupt or interfere with the security, integrity, or gameplay servers of the Game.</p>
        <p className="pl-8">- Attempt to gain unauthorized access to other users' accounts or server infrastructure.</p>
        <p className="pl-8">- Reverse engineer, decompile, or modify the Game's code or assets without permission.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">3. Intellectual Property</p>
        <p>All content, code, artwork, audio, and materials within the Game are owned by us and are protected by intellectual property laws.</p>
        <p>You are granted a personal, non-exclusive, non-transferable license to play the Game for personal, non-commercial use.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">4. Account Termination</p>
        <p>We reserve the right to suspend or terminate your account or access to the Game at our discretion, without prior notice, if you violate these Terms or engage in fraudulent or harmful behavior.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">5. Disclaimer & Limitation of Liability</p>
        <p>- The Game is provided on an "AS IS" and "AS AVAILABLE" basis without warranties of any kind.</p>
        <p>- We do not guarantee that the Game will be uninterrupted, error-free, or secure.</p>
        <p>- To the maximum extent permitted by law, we shall not be liable for any direct, indirect, incidental, or consequential damages resulting from your use of or inability to use the Game.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">6. Changes to These Terms</p>
        <p>We may update these Terms from time to time. Continued use of the Game after updates are posted constitutes your acceptance of the revised Terms.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">7. Contact Us</p>
        <p>If you have any questions regarding these Terms, please contact us at: Hive Helsinki</p>
      </>
    ),
  },
  priv: {
    title: 'Privacy Policy',
    body: (
      <>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">1. Information we collect</p>
        <p>Information you provide: Account details (username, email).</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">2. How We Use Information</p>
        <p>We use your data to:</p>
        <p className="pl-8">- Provide and maintain core gameplay functionality.</p>
        <p className="pl-8">- Prevent cheating, hacking, and unauthorized activity.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">3. Data Sharing</p>
        <p>We do not sell, rent, or share your personal data with third parties, except as required by law.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">4. Payments</p>
        <p>The game does not offer in-game purchases, and we do not collect or store any payment details.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">5. Children's Privacy</p>
        <p>The game is not intended for children under 13 (or under 16 in the EU/UK). We do not knowingly collect personal data from children under these ages.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">6. Your Rights & Data Retention</p>
        <p>You may request access to, correction of, or deletion of your personal data at any time by contacting us.</p>
        <p>We retain data only as long as necessary to provide game services or comply with legal obligations.</p>
        <p className="text-neon-cyan text-[clamp(10px,2.3vh,60px)]">7. Contact Us</p>
        <p>If you have any questions or data requests, contact us at: Hive Helsinki</p>
    </>
    ),
  },
  cre: {
    title: 'Credits',
    body: (
      <>
        <p className="text-[var(--gamify-neon-yellow)] text-center text-[clamp(10px,2.3vh,60px)]">Mika</p>
        <p>the one who sacrifices sleep to increasingly perfect the game each passing day and jumps in all sectors for enhanced quality control</p>
        <p className="text-[var(--gamify-neon-yellow)] text-center text-[clamp(10px,2.3vh,60px)]">Daniel</p>
        <p>the one who protects by imposing strict security and approves PRs fast like the wind to promote main branch's growth</p>
        <p className="text-[var(--gamify-neon-yellow)] text-center text-[clamp(10px,2.3vh,60px)]">Janne</p>
        <p>the one who builds the extensive data system and lowkey is a plumber of wealth since data is the new gold</p>
        <p className="text-[var(--gamify-neon-yellow)] text-center text-[clamp(10px,2.3vh,60px)]">Cristian</p>
        <p>the one who raises the army of BunnyBots who has now evolved into BeastBots that can humble players</p>
        <p className="text-[var(--gamify-neon-yellow)] text-center text-[clamp(10px,2.3vh,60px)]">Giang</p>
        <p>the one who moves components 1px to the left and 2px to the right :D</p>
      </>
    ),
  },
}

const Popup = ({ kind, onClose }: Props) => {
  if (!kind) return null

  const { title, body } = CONTENT[kind]

  return (
    // Darken overlay
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70">
      {/* Popup window */}
      <GamifyCard variant="cyber" style={{ 
            width: 'clamp(320px, 40vw, 1600px)',
            height: 'clamp(240px, 60vh, 1800px)',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px' }}>
        
        {/* Title and body content */}
        <h2 className="mt-[30px] text-[clamp(10px,4.8vh,84px)] font-heading text-neon-cyan">{title}</h2>
        <div className="text-[clamp(10px,2vh,30px)] font-body overflow-y-auto w-5/6">{body}</div>
        
        <GamifyButton variant="outline"
          onClick={onClose}
          style={{ marginTop: 'auto', padding: '8px 16px', cursor: 'pointer' }}
        >
          Close
        </GamifyButton>
    </GamifyCard>
    </div>
  )
}

export default Popup