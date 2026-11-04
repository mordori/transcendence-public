import { useEffect, useRef, useState } from "react";
import type { SubmitEvent } from "react";
import { ProfileApiError } from "../lib/profile-api";

// @ts-expect-error: TypeScript cannot resolve this package's declarations.
import { GamifyButton } from "@sitharaj08/gamify";

type UsernameEditorProps = {
  currentUsername: string;
  usernameChangedAt: string | null;
  disabled?: boolean;
  onSave: (username: string) => Promise<void>;
};

const USERNAME_COOLDOWN_MS = 1 * 60 * 60 * 1000;

function nextChangeTime(
  usernameChangedAt: string | null,
): number {
  if (!usernameChangedAt) {
	return 0;
  }

  const changedAt = Date.parse(usernameChangedAt);

  return Number.isFinite(changedAt)
	? changedAt + USERNAME_COOLDOWN_MS
	: 0;
}

export default function UsernameEditor({
  currentUsername,
  usernameChangedAt,
  disabled = false,
  onSave,
}: UsernameEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentUsername);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(
	null,
  );
  const [successMessage, setSuccessMessage] = useState<
	string | null
  >(null);
  const [serverAvailableAt, setServerAvailableAt] =
	useState(0);
  const [now, setNow] = useState(() => Date.now());

  const savingRef = useRef(false);

  // Recheck the displayed cooldown without requiring a refresh.
  useEffect(() => {
	const intervalId = window.setInterval(() => {
	  setNow(Date.now());
	}, 1000);

	return () => window.clearInterval(intervalId);
  }, []);

  const availableAt = Math.max(
	nextChangeTime(usernameChangedAt),
	serverAvailableAt,
  );

  const cooldownActive = availableAt > now;
  const trimmedUsername = draft.trim();
  const validUsername = /^[A-Za-z0-9]{3,20}$/.test(
	trimmedUsername,
  );
  const unchanged = trimmedUsername === currentUsername;

  const availableDate = new Date(availableAt);

  const availableDateLabel = availableDate.toLocaleDateString(
	"en-GB",
	{
		day: "numeric",
		month: "short",
		year: "numeric",
	},
	);

  const availableTimeLabel = availableDate.toLocaleTimeString(
	"en-GB",
	{
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	},
	);

  const cooldownMessage = cooldownActive
	? `You can change your username again on ${availableDateLabel} at ${availableTimeLabel} (local time).`
	: "You can change your username once every hour.";

  function openEditor() {
   const currentTime = Date.now();

   setNow(currentTime);

   if (
	 disabled ||
	 savingRef.current ||
	 availableAt > currentTime
   ) {
	 return;
   }

   setDraft(currentUsername);
   setSaveError(null);
   setSuccessMessage(null);
   setEditing(true);
  }

  function cancelEditing() {
	if (savingRef.current) {
	  return;
	}

	setDraft(currentUsername);
	setSaveError(null);
	setEditing(false);
  }

  async function handleSubmit(
	event: SubmitEvent<HTMLFormElement>,
  ) {
	event.preventDefault();

	if (disabled || savingRef.current) {
	  return;
	}

	if (!validUsername) {
	  setSaveError(
		"Use 3–20 characters containing only letters and numbers.",
	  );
	  return;
	}

	if (unchanged) {
	  cancelEditing();
	  return;
	}

	if (cooldownActive) {
	  setSaveError(cooldownMessage);
	  return;
	}

	savingRef.current = true;
	setSaving(true);
	setSaveError(null);
	setSuccessMessage(null);

	try {
	  await onSave(trimmedUsername);

	  setServerAvailableAt(0);
	  setSuccessMessage("Username updated.");
	  setEditing(false);
	} catch (error) {
	  if (
		error instanceof ProfileApiError &&
		error.status === 429 &&
		error.availableAt
	  ) {
		setServerAvailableAt(Date.parse(error.availableAt));
		setNow(Date.now());
	  }

	  setSaveError(
		error instanceof Error
		  ? error.message
		  : "Could not save your username. Please try again.",
	  );
	} finally {
	  savingRef.current = false;
	  setSaving(false);
	}
}

return (
	<section
		aria-label="Username settings"
		className="flex flex-col gap-3 text-white font-body"
	>
		{!editing && (
		<GamifyButton
			type="button"
			variant="primary"
			size="lg"
			disabled={disabled || saving || cooldownActive}
			aria-describedby="username-change-help"
			onClick={openEditor}
		>
			Change username
		</GamifyButton>
		)}

		<p
		id="username-change-help"
		className="m-0 text-[0.85rem] leading-normal text-zinc-300"
		>
		{cooldownMessage}
		</p>

		{successMessage && (
		<p role="status" className="m-0">
			{successMessage}
		</p>
		)}

		{editing && (
		<form
			onSubmit={(event) => void handleSubmit(event)}
			aria-busy={saving}
			className="flex flex-col gap-3"
		>
			<label htmlFor="profile-username">New username</label>

			<input
			id="profile-username"
			name="username"
			type="text"
			autoComplete="username"
			autoCapitalize="none"
			spellCheck={false}
			value={draft}
			maxLength={20}
			disabled={disabled || saving}
			aria-describedby="username-change-help username-format-help"
			aria-invalid={saveError !== null}
			onChange={(event) => {
				setDraft(event.target.value);
				setSaveError(null);
			}}
			className="w-full p-3 border border-[var(--gamify-neon-cyan)] rounded-lg bg-[#151522] text-white [font:inherit]"
			/>

			<p
			id="username-format-help"
			className="m-0 text-[0.85rem] text-zinc-300"
			>
			Use 3–20 letters or numbers. No spaces or symbols.
			</p>

			{saveError && (
			<p role="alert" className="m-0 text-[#ff6b6b]">
				{saveError}
			</p>
			)}

			{saving && (
			<p role="status" className="m-0">
				Saving your username…
			</p>
			)}

			<div className="grid grid-cols-2 gap-3">
			<GamifyButton
				type="button"
				variant="outline"
				size="lg"
				disabled={saving}
				onClick={cancelEditing}
				className="w-full min-w-0 px-3"
			>
				Cancel
			</GamifyButton>

			<GamifyButton
				type="submit"
				variant="primary"
				size="lg"
				disabled={disabled || saving || unchanged || cooldownActive}
				className="w-full min-w-0 px-3"
			>
				Save
			</GamifyButton>
			</div>
		</form>
		)}
	</section>
);
}
