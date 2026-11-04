export type Account = {
  accountId: string;
  username: string;
  email: string;
  avatarId: string | null;
  usernameChangedAt: string | null;
};

type AccountResponse = {
  account: Account;
};

type LoginInput = {
  email: string;
  password: string;
};

type SignupInput = LoginInput & {
  username: string;
};

export class AuthApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
	super(message);
	this.name = "AuthApiError";
	this.status = status;
  }
}

function errorMessage(status: number): string {
  switch (status) {
	case 400:
	  return "Check the information you entered.";
	case 401:
	  return "Your email or password is incorrect.";
	case 403:
	  return "The authentication request was rejected.";
	case 409:
	  return "An account with that email or username already exists.";
	case 429:
	  return "Too many login attempts. Wait a minute and try again.";
	default:
	  return "The server could not complete the request. Please try again.";
  }
}

async function authRequest<T>(
  path: string,
  options: {
	method?: "GET" | "POST";
	body?: LoginInput | SignupInput;
	signal?: AbortSignal;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers({
	Accept: "application/json",
  });

  if (method === "POST") {
	headers.set("x-auth-request", "1");
  }

  if (options.body !== undefined) {
	headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`/api/auth/${path}`, {
	method,
	headers,
	credentials: "same-origin",
	cache: "no-store",
	signal: options.signal,
	body:
	  options.body === undefined
		? undefined
		: JSON.stringify(options.body),
  });

  if (!response.ok) {
	let message = errorMessage(response.status);

	if (response.status === 409) {
		const body: unknown = await response.json().catch(() => null);

		if (
			typeof body === "object" &&
			body !== null &&
			"code" in body &&
			body.code === "ACCOUNT_ALREADY_LOGGED_IN"
		){
			message = "Account already logged in";
		}
	}
	throw new AuthApiError(response.status, message);
  }

  // Logout returns 204: there is no JSON body to read.
  if (response.status === 204) {
	return undefined as T;
  }

  return (await response.json()) as T;
}

export const authApi = {
  async signup(input: SignupInput): Promise<Account> {
	const result = await authRequest<AccountResponse>("register", {
	  method: "POST",
	  body: input,
	});

	return result.account;
  },

  async login(input: LoginInput): Promise<Account> {
	const result = await authRequest<AccountResponse>("login", {
	  method: "POST",
	  body: input,
	});

	return result.account;
  },

  async currentAccount(signal?: AbortSignal): Promise<Account | null> {
	try {
	  const result = await authRequest<AccountResponse>("me", {
		signal,
	  });

	  return result.account;
	} catch (error) {
	  // Only 401 means that there is no valid session.
	  // Network failures and server failures must remain errors.
	  if (error instanceof AuthApiError && error.status === 401) {
		return null;
	  }

	  throw error;
	}
  },

  async logout(): Promise<void> {
	await authRequest<void>("logout", {
	  method: "POST",
	});
  },
};
