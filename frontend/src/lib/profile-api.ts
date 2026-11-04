import type { Account } from "./auth-api";

type AccountResponse = {
  account: Account;
};

export class ProfileApiError extends Error {
  readonly status: number;
  readonly availableAt: string | null;

  constructor(
	status: number,
	message: string,
	availableAt: string | null = null,
  ) {
	super(message);
	this.name = "ProfileApiError";
	this.status = status;
	this.availableAt = availableAt;
  }
}

function errorMessage(
  status: number,
  field: "avatar" | "username",
): string {
  switch (status) {
	case 400:
	  return field === "username"
		? "Use 3–20 characters containing only letters and numbers."
		: "Choose one of the available avatars.";

	case 401:
	  return "Your session has expired. Please sign in again.";

	case 403:
	  return "The request was rejected. Refresh the page and try again.";

	case 409:
	  return "That username is already taken.";

	case 429:
	  return "You can change your username once every hour.";

	default:
	  return `Could not save your ${field}. Please try again.`;
  }
}

async function profileRequest(
  field: "avatar" | "username",
  body: { avatarId: string } | { username: string },
): Promise<Account> {
  const response = await fetch(`/api/profile/${field}`, {
	method: "PATCH",
	credentials: "same-origin",
	cache: "no-store",
	headers: {
	  Accept: "application/json",
	  "Content-Type": "application/json",
	  "x-auth-request": "1",
	},
	body: JSON.stringify(body),
  });

  if (!response.ok) {
	const details: unknown = await response
	  .json()
	  .catch(() => null);

	let availableAt: string | null = null;

	if (
	  typeof details === "object" &&
	  details !== null &&
	  "availableAt" in details &&
	  typeof details.availableAt === "string" &&
	  Number.isFinite(Date.parse(details.availableAt))
	) {
	  availableAt = details.availableAt;
	}

	throw new ProfileApiError(
	  response.status,
	  errorMessage(response.status, field),
	  availableAt,
	);
  }

  const result = (await response.json()) as AccountResponse;
  return result.account;
}

export const profileApi = {
  async changeAvatar(avatarId: string): Promise<Account> {
	return profileRequest("avatar", { avatarId });
  },

  async changeUsername(username: string): Promise<Account> {
	return profileRequest("username", { username });
  },
};
