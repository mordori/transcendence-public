import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useNavigate } from 'react-router-dom'

import PlayerAvatar from "../components/PlayerAvatar";
import AvatarPicker from "@/components/AvatarPicker";
import UsernameEditor from "@/components/UsernameEditor";

// @ts-expect-error: TypeScript cannot resolve this package's declarations.
import { GamifyButton, GamifyCard } from '@sitharaj08/gamify';
import Footer from '@/components/Footer'

const Profile = () => {
  const navigate = useNavigate();
  const { account, logout, changeAvatar, changeUsername } = useAuth();

  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
    } catch {
      setLogoutError("Logout failed. Please try again.");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="relative min-h-dvh box-border py-6 flex flex-col items-center justify-center bg-[#0a0a14]
                    bg-[radial-gradient(ellipse_60%_50%_at_85%_45%,rgba(236,72,72,0.25),transparent_40%),radial-gradient(ellipse_60%_50%_at_20%_20%,rgba(6,44,212,0.25),transparent_40%),radial-gradient(circle_at_center,#292937_0%,#0a0a14_100%)]">

      {/* Header */}
      <div className="HEADER flex flex-col items-center w-full max-w-[2500px] gap-[clamp(0px,1.5vh,50px)]">
        <h1 className="self-start mt-0 mr-0 mb-[clamp(16px,3vh,40px)] ml-[clamp(24px,8vw,120px)]
                       text-[clamp(32px,4.8vw,84px)] tracking-[0.1em] text-neon-cyan font-heading font-bold">
          Profile
        </h1>
      </div>

      {logoutError && (
        <p role="alert" className="text-[#ff4d4d] text-center mb-[clamp(8px,2vh,16px)]">
          {logoutError}
        </p>
      )}

      {account && (
        <div className="flex gap-[clamp(0px,1.5vw,80px)]">

          {/* LEFT — Avatar */}
          <GamifyCard variant="common" style={{
            width: 'clamp(320px, 35vw, 900px)',
            padding: 'clamp(10px, 3vw, 80px)',
            background: 'rgba(0, 0, 0, 0.4)',
            borderColor: 'var(--gamify-neon-cyan)',
            maxHeight: 'clamp(240px, 60vh, 1000px)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(12px, 2.5vh, 60px)',
          }}>

            <div className="scale-300 origin-center m-10">
							<PlayerAvatar avatarId={account.avatarId} />
						</div>

            <AvatarPicker
              currentAvatarId={account.avatarId}
              disabled={loggingOut}
              onSave={changeAvatar}
            />
          </GamifyCard>

          {/* RIGHT — Username */}
          <GamifyCard variant="common" style={{
            width: 'clamp(320px, 35vw, 900px)',
            padding: 'clamp(10px, 3vw, 80px)',
            background: 'rgba(0, 0, 0, 0.4)',
            borderColor: 'var(--gamify-neon-cyan)',
            maxHeight: 'clamp(240px, 60vh, 1000px)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
						justifyContent: 'center',
            gap: 'clamp(12px, 2vh, 24px)',
          }}>

            <p className="text-yellow-300 font-body text-[clamp(20px,2vw,60px)] m-0">
							<strong>{account.username}</strong>
            </p>

            <UsernameEditor
              key={account.accountId}
              currentUsername={account.username}
              usernameChangedAt={account.usernameChangedAt}
              disabled={loggingOut}
              onSave={changeUsername}
            />

							<GamifyButton
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void handleLogout()}
								disabled={loggingOut}
							>
								{loggingOut ? "Logging out…" : "Logout"}
							</GamifyButton>
          </GamifyCard>

        </div>
      )}

      {/* Bottom buttons — Back + Logout */}
      <div className="flex gap-[clamp(16px,5vw,200px)] p-[clamp(0px,1.5vh,30px)]
                      justify-center mt-[clamp(8px,5vh,80px)]">
        <GamifyButton
          type="button"
          variant="outline"
          size="lg"
          onClick={() => navigate("/main-menu")}
          disabled={loggingOut}
        >
          Back
        </GamifyButton>
      </div>

      <Footer />
    </div>
  );
};

export default Profile;