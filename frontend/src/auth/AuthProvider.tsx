import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { authApi } from "../lib/auth-api";
import type { Account } from "../lib/auth-api";
import { AuthContext } from "./auth-context";

import {
	profileApi,
	ProfileApiError,
} from "../lib/profile-api";

const AUTH_CHANNEL = "transcendence-auth";
const SESSION_CHECK_INTERVAL = 60_000;

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState<string | null>(
	null,
  );
  const [retryCount, setRetryCount] = useState(0);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const sessionCheckRef = useRef<AbortController | null>(null);

  // Incremented when authentication changes invalidate old work.
  const authVersionRef = useRef(0);

  // Prevent profile changes during login, signup, or logout.
  const authActionRef = useRef(false);

  // Prevent overlapping avatar saves in this tab.
  const avatarSaveRef = useRef(false);

  // Prevent overlapping username saves in this tab.
  const usernameSaveRef = useRef(false);

  useEffect(() => {
	let disposed = false;
	let startupPending = true;

	const channel =
	  typeof BroadcastChannel === "undefined"
		? null
		: new BroadcastChannel(AUTH_CHANNEL);

	channelRef.current = channel;

	async function checkSession(isStartup = false) {
	  if (disposed || authActionRef.current) {
		return;
	  }

	  const authVersion = authVersionRef.current;

	  // A newer check replaces the previous one.
	  sessionCheckRef.current?.abort();

	  const controller = new AbortController();
	  sessionCheckRef.current = controller;

	  if (isStartup) {
		setLoading(true);
		setStartupError(null);
	  }
	  try {
		const restoredAccount = await authApi.currentAccount(
		  controller.signal,
		);

		if (disposed ||
			controller.signal.aborted ||
			authVersion !== authVersionRef.current
		) {
		  return;
		}

		// A confirmed missing session invalidates pending profile responses.
		if (restoredAccount === null) {
			authVersionRef.current += 1;
		}

		setAccount(restoredAccount);

		if (!isStartup) {
		  setLoggedOut(restoredAccount === null);
		}
	  } catch {
		if (disposed || controller.signal.aborted) {
		  return;
		}

		if (isStartup) {
		  setStartupError(
			"Could not check your session. Check your connection and retry.",
		  );
		} else {
		  // A failed request does not prove that the session expired.
		  console.warn(
			"Could not refresh the session. Keeping the current login display.",
		  );
		}
	  } finally {
		if (sessionCheckRef.current === controller) {
		  sessionCheckRef.current = null;
		}

		if (isStartup && !disposed && !controller.signal.aborted) {
		  startupPending = false;
		  setLoading(false);
		}
	  }
	}

	function refreshVisibleSession() {
	  if (
		startupPending ||
		document.visibilityState !== "visible"
	  ) {
		return;
	  }

	  void checkSession();
	}

	function handleAuthMessage(event: MessageEvent<unknown>) {
	  if (!startupPending && event.data === "session-changed") {
		// Another tab may have logged out or changed accounts.
		authVersionRef.current += 1;
		void checkSession();
	  }
	}

	channel?.addEventListener("message", handleAuthMessage);

	window.addEventListener("focus", refreshVisibleSession);
	document.addEventListener(
	  "visibilitychange",
	  refreshVisibleSession,
	);

	const intervalId = window.setInterval(
	  refreshVisibleSession,
	  SESSION_CHECK_INTERVAL,
	);

	void checkSession(true);

	return () => {
	  disposed = true;
	  authVersionRef.current += 1;

	  sessionCheckRef.current?.abort();
	  sessionCheckRef.current = null;

	  window.clearInterval(intervalId);

	  window.removeEventListener(
		"focus",
		refreshVisibleSession,
	  );
	  document.removeEventListener(
		"visibilitychange",
		refreshVisibleSession,
	  );

	  channel?.removeEventListener(
		"message",
		handleAuthMessage,
	  );
	  channel?.close();

	  if (channelRef.current === channel) {
		channelRef.current = null;
	  }
	};
  }, [retryCount]);

  function cancelSessionCheck() {
	sessionCheckRef.current?.abort();
	sessionCheckRef.current = null;
  }

  function notifyOtherTabs() {
	channelRef.current?.postMessage("session-changed");
  }

  async function runAuthAction(
	action: () => Promise<Account | null>,
	loggedOutAfter: boolean,
	): Promise<void> {
  	if (authActionRef.current) {
		throw new Error(
	  	"Another authentication request is already in progress.",
		);
	}

	authActionRef.current = true;
	authVersionRef.current += 1;
	cancelSessionCheck();

	try {
		const nextAccount = await action();

		// Discard work started while the request was in progress.
		authVersionRef.current += 1;
		cancelSessionCheck();

		setLoggedOut(loggedOutAfter);
		setAccount(nextAccount);
		notifyOtherTabs();
	} finally {
		authActionRef.current = false;
	}
	}

  async function login(email: string, password: string) {
	await runAuthAction(
		() => authApi.login({ email, password }),
		false,
		);
	}

  async function signup(
	username: string,
	email: string,
	password: string,
  ) {
	await runAuthAction(
		() => authApi.signup({ username, email, password }),
		false,
		);
  	}


  async function logout() {
	await runAuthAction(async () => {
		await authApi.logout();
		return null;
	}, true);
  }

  async function changeAvatar(avatarId: string): Promise<void> {
	if (!account || authActionRef.current) {
	throw new Error(
		"Your session is changing. Please try again.",
	);
  }

  if (avatarSaveRef.current) {
	throw new Error("An avatar save is already in progress.");
  }

  const accountId = account.accountId;
  const authVersion = authVersionRef.current;

  avatarSaveRef.current = true;
  cancelSessionCheck();

  try {
	const updatedAccount = await profileApi.changeAvatar(avatarId);

	if (
	  authVersion !== authVersionRef.current ||
	  authActionRef.current
	) {
	  throw new Error(
		"Your session changed while saving. Reopen your profile and check your avatar.",
	  );
	}

	if (updatedAccount.accountId !== accountId) {
	  throw new Error(
		"The server returned an unexpected account. Refresh the page.",
	  );
	}

	// An older background check must not overwrite this save.
	cancelSessionCheck();

	setAccount((currentAccount) => {
	  if (
		authVersion !== authVersionRef.current ||
		currentAccount?.accountId !== accountId
	  ) {
		return currentAccount;
	  }

	  // Update only the field changed by this operation.
	  return {
		...currentAccount,
		avatarId: updatedAccount.avatarId,
	  };
	});

	notifyOtherTabs();
  } catch (error) {
	if (
	  error instanceof ProfileApiError &&
	  error.status === 401 &&
	  authVersion === authVersionRef.current &&
	  !authActionRef.current
	) {
	  authVersionRef.current += 1;
	  cancelSessionCheck();

	  setAccount(null);
	  setLoggedOut(true);
	  notifyOtherTabs();
	}

	throw error;
  } finally {
	avatarSaveRef.current = false;
  }
}

async function changeUsername(username: string): Promise<void> {
  if (!account || authActionRef.current) {
	throw new Error(
	  "Your session is changing. Please try again.",
	);
  }

  if (usernameSaveRef.current) {
	throw new Error(
	  "A username save is already in progress.",
	);
  }

  const accountId = account.accountId;
  const authVersion = authVersionRef.current;

  usernameSaveRef.current = true;
  cancelSessionCheck();

  try {
	const updatedAccount = await profileApi.changeUsername(
	  username,
	);

	if (
	  authVersion !== authVersionRef.current ||
	  authActionRef.current
	) {
	  throw new Error(
		"Your session changed while saving. Reopen your profile and check your username.",
	  );
	}

	if (updatedAccount.accountId !== accountId) {
	  throw new Error(
		"The server returned an unexpected account. Refresh the page.",
	  );
	}

	// Prevent an older session check from replacing this save.
	cancelSessionCheck();

	setAccount((currentAccount) => {
	  if (
		authVersion !== authVersionRef.current ||
		currentAccount?.accountId !== accountId
	  ) {
		return currentAccount;
	  }

	  // Preserve unrelated fields, including the current avatar.
	  return {
		...currentAccount,
		username: updatedAccount.username,
		usernameChangedAt: updatedAccount.usernameChangedAt,
	  };
	});

	notifyOtherTabs();
  } catch (error) {
	if (
	  error instanceof ProfileApiError &&
	  error.status === 401 &&
	  authVersion === authVersionRef.current &&
	  !authActionRef.current
	) {
	  authVersionRef.current += 1;
	  cancelSessionCheck();

	  setAccount(null);
	  setLoggedOut(true);
	  notifyOtherTabs();
	}

	throw error;
  } finally {
	usernameSaveRef.current = false;
  }
}

  if (loading) {

	return <p role="status">Checking your session…</p>;
  }

  if (startupError) {
	return (
	  <div role="alert">
		<p>{startupError}</p>
		<button
		  onClick={() => setRetryCount((count) => count + 1)}
		>
		  Retry
		</button>
	  </div>
	);
  }

  return (
	<AuthContext.Provider
	  value={{
		account,
		loggedOut,
		login,
		signup,
		logout,
		changeAvatar,
		changeUsername,
	}}
	>
	  {children}
	</AuthContext.Provider>
  );
}
