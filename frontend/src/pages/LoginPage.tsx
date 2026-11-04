import { useState } from "react";
import type { ChangeEvent, SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

// @ts-expect-error: TypeScript cannot resolve this package's declarations.
import { GamifyCard, GamifyButton, GamifyInput, GamifySpinner } from "@sitharaj08/gamify";
import Footer from "@/components/Footer";

const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleLogin = async () => {
	if (loading) return;

	setFormError(null);

	const normalizedEmail = email.trim().toLowerCase();

	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
	  setFormError("Enter a valid email address.");
	  return;
	}

	if (!password) {
	  setFormError("Enter your password.");
	  return;
	}

	setLoading(true);

	try {
	  await login(normalizedEmail, password);
	  navigate("/main-menu", { replace: true });
	} catch (error) {
	  setFormError(
		error instanceof Error
		  ? error.message
		  : "Could not log in.",
	  );
	} finally {
	  setLoading(false);
	}
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
	event.preventDefault();
	void handleLogin();
  };

  return (
	<div
	  style={{
		position: "absolute",
		inset: 0,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: '#0a0a14',
        backgroundImage: [
          /* Red glow - radial-gradient(ellipse width height at X Y, color1, color2) */
          'radial-gradient(ellipse 60% 50% at 85% 45%, rgba(236, 72, 72, 0.25), transparent 40%)',
          /* Blue glow */
          'radial-gradient(ellipse 60% 50% at 20% 20%, rgba(6, 44, 212, 0.25), transparent 40%)',
          /* Center glow */
          'radial-gradient(circle at center, #292937 0%, #0a0a14 100%)',
        ].join(', '),
	  }}
	>
	  <GamifyCard
		variant="cyber"
		style={{
		  position: "relative",
		  width: "clamp(320px, 70vw, 2000px)",
		  height: "clamp(240px, 70vh, 1500px)",
		  padding: "clamp(16px, 3vw, 60px)",
		  textAlign: "center",
		  background: "rgba(0, 0, 0, 0.4)",
		  display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'clamp(0px, 1.5vh, 30px)',
		}}
	  >       
		<h1
		  style={{
			fontSize: "clamp(10px, 4.8vw, 120px)",
			letterSpacing: "0.1em",
			margin:
			  "clamp(8px, 2vh, 16px) 0 clamp(4px, 2vh, 8px)",
			color: "var(--gamify-neon-cyan)",
			fontFamily: "var(--gamify-font-heading)",
			fontWeight: "bold",
		  }}
		>
		  NOT Rocket League
		</h1>

        <p style={{
          textAlign: 'center',
          fontSize: 'clamp(10px, 1.2vw, 72px)',
          opacity: 0.7,
          margin: '0 0 clamp(4px, 2vh, 8px)',
          color: 'white',
          fontFamily: 'var(--gamify-font-body)'
        }}>
          ~~ Connect with existing account ~~
        </p>
		
		<div
		  role="alert"
		  style={{
			color: "#ff4d4d",
			background: "rgba(255, 77, 77, 0.1)",
			border: "1px solid rgba(255, 77, 77, 0.3)",
			borderRadius: "6px",
			padding: '0 clamp(8px, 1.2vh, 20px)',
			textAlign: "center",
			fontSize: "clamp(8px, 1.5vw, 15px)",
			visibility: formError ? "visible" : "hidden",
		  }}
		>
		  {formError}
		</div>

		<form
		  onSubmit={handleSubmit}
		  style={{
			width: "100%",
			flex: 1,
    		minHeight: 0,
    		display: "flex",
    		flexDirection: "column",
		  }}
		  aria-busy={loading}
		  noValidate
		>
		  <div className='input-fields'
			style={{
			  display: "flex",
			  flexDirection: "column",
			  textAlign: "left",
			  width: "clamp(100px, 50%, 400px)",
			  overflow: "auto",
			  margin: "clamp(8px, 0.5vh, 20px) auto clamp(8px, 3.5vh, 80px)",
			}}
		  >
			<GamifyInput
			  label="Email"
			  name="email"
			  type="email"
			  placeholder="Enter email"
			  autoComplete="username"
			  value={email}
			  onChange={(event: ChangeEvent<HTMLInputElement>) =>
				setEmail(event.target.value)
			  }
			  disabled={loading}
			/>

			<GamifyInput
			  label="Password"
			  name="password"
			  type="password"
			  placeholder="Enter password"
			  autoComplete="current-password"
			  value={password}
			  onChange={(event: ChangeEvent<HTMLInputElement>) =>
				setPassword(event.target.value)
			  }
			  disabled={loading}
			/>
		  </div>

		  <div
			style={{
			  display: "flex",
			  gap: "clamp(32px, 6vw, 120px)",
			  justifyContent: "center",
			}}
		  >
			<GamifyButton
			  type="button"
			  variant="outline"
			  size="lg"
			  onClick={() => navigate("/title")}
			  disabled={loading}
			>
			  BACK
			</GamifyButton>

			<GamifyButton
			  type="submit"
			  variant="primary"
			  size="lg"
			  disabled={loading}
			>
			  LOGIN
			</GamifyButton>
		  </div>
		</form>

		{loading && (
		  <div
			role="status"
			aria-label="Logging in"
			style={{
			  position: "absolute",
			  inset: 0,
			  background: "rgba(0, 0, 0, 0.6)",
			  display: "flex",
			  alignItems: "center",
			  justifyContent: "center",
			  borderRadius: "inherit",
			  zIndex: 10,
			}}
		  >
			<GamifySpinner size="lg" />
		  </div>
		)}
	  </GamifyCard>

	  <Footer />
	</div>
  );
};

export default LoginPage;
