import { Routes, Route, Navigate, Outlet,}  from 'react-router-dom'
import GameTitle from './pages/GameTitle'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import IngameCanvas from './pages/IngameCanvas'
import MainMenu from './pages/MainMenu'
import StartGame from './pages/StartGame'
import Profile from './pages/Profile'
import Manual from './pages/Manual'
import Lobby from './pages/MatchLobby'
import BackgroundMusic from './components/BackgroundMusic'

import { useAuth } from "./auth/useAuth";

function RequireAccount() {
  const { account, loggedOut } = useAuth();

  if (!account) {
	return (
		<Navigate
			to={loggedOut ? "/title" : "/login"}
			replace
		/>
	);
  }

  return <Outlet />;
}

function GuestOnly() {
  const { account } = useAuth();

  if (account) {
	return <Navigate to="/main-menu" replace />;
  }

  return <Outlet />;
}

export default function App() {
  return (
	<>
	<BackgroundMusic />
	<Routes>
	  <Route
		path="/"
		element={<Navigate to="/title" replace />}
	  />

	  <Route path="/title" element={<GameTitle />} />

	  <Route element={<GuestOnly />}>
		<Route path="/login" element={<LoginPage />} />
		<Route path="/signup" element={<SignupPage />} />
	  </Route>

	  <Route element={<RequireAccount />}>
		<Route path="/main-menu" element={<MainMenu />} />
		<Route path="/start-game" element={<StartGame />} />
		<Route path="/profile" element={<Profile />} />
		<Route path="/manual" element={<Manual />} />
		<Route path="/lobby" element={<Lobby/>} />
		<Route path="/battle" element={<IngameCanvas />} />
	  </Route>

	  <Route
		path="*"
		element={<Navigate to="/title" replace />}
	  />
	</Routes>
	</>
  );
}
