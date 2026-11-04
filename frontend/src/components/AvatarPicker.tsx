import { useRef, useState } from "react";
import PlayerAvatar, { AVATARS } from "./PlayerAvatar";

// @ts-expect-error: TypeScript cannot resolve this package's declarations.
import { GamifyButton } from "@sitharaj08/gamify";

type AvatarPickerProps = {
  currentAvatarId: string | null;
  disabled?: boolean;
  onSave: (avatarId: string) => Promise<void>;
};

const AVATAR_LABELS: Record<string, string> = {
  default: "Default",
  red_car: "Red car",
  blue_car: "Blue car",
};

const AVATAR_IDS = Object.keys(AVATARS);

export default function AvatarPicker({
  currentAvatarId,
  disabled = false,
  onSave,
}: AvatarPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [selectedId, setSelectedId] = useState("default");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // This closes the small gap before React renders disabled buttons.
  const savingRef = useRef(false);

  function openPicker() {
	if (disabled || savingRef.current) {
		return;
	}

	let initialId = currentAvatarId ?? "default";

	if (!AVATAR_IDS.includes(initialId)) {
	  initialId = "default";
	}

	setSelectedId(initialId);
	setSaveError(null);
	dialogRef.current?.showModal();
  }

  function closePicker() {
	if (savingRef.current) {
		return;
	}
	dialogRef.current?.close();
  }

  async function handleSave() {
	if (disabled || savingRef.current) {
		return;
	}

	// No request is needed when the selection has not changed.
	if (selectedId === (currentAvatarId ?? "default")) {
		closePicker();
		return;
	}

	savingRef.current = true;
	setSaving(true);
	setSaveError(null);

	try {
		await onSave(selectedId);
		dialogRef.current?.close();
	} catch (error) {
		setSaveError(
			error instanceof Error
			? error.message
			: "Could not save your avatar. Please try again.",
		);
	} finally {
		savingRef.current = false;
		setSaving(false);
	}
  }

return (
  <>
    <GamifyButton
      type="button"
      variant="primary"
      size="lg"
      disabled={disabled || saving}
      onClick={openPicker}
    >
      Change avatar
    </GamifyButton>

    <dialog
      ref={dialogRef}
      aria-labelledby="avatar-picker-title"
      aria-describedby="avatar-picker-description"
      aria-busy={saving}
      onCancel={(event) => {
        if (savingRef.current) {
          event.preventDefault();
        }
      }}
      className="w-[clamp(320px, 40vw, 1600px)] max-h-[75vh] overflow-y-auto m-auto p-6 border border-neon-cyan rounded-2xl bg-[#0a0a14] text-white font-body"
    >
      <h2
        id="avatar-picker-title"
        className="mt-0 text-neon-cyan font-heading"
      >
        Choose your avatar
      </h2>

      <p id="avatar-picker-description">
        Choose an avatar, then press Save to update your profile.
      </p>

      <fieldset
        disabled={saving || disabled}
        className="my-5 p-4 border border-zinc-600 rounded-xl"
      >
        <legend>Available avatars</legend>

        <div className="flex flex-wrap justify-center gap-4">
          {AVATAR_IDS.map((avatarId) => (
            <label
              key={avatarId}
              className="flex flex-col items-center gap-2 p-3 cursor-pointer"
            >
              <input
                type="radio"
                name="profile-avatar"
                value={avatarId}
                checked={selectedId === avatarId}
                onChange={() => setSelectedId(avatarId)}
              />
							<div className="scale-200 origin-center m-10">
              <PlayerAvatar avatarId={avatarId} /></div>

              <span>
                {AVATAR_LABELS[avatarId] ?? avatarId}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {saving && (
        <p role="status">
          Saving your avatar...
        </p>
      )}

      {saveError && (
        <p role="alert" className="text-[#ff6b6b] mb-4">
          {saveError}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 w-full">
        <GamifyButton
          type="button"
          variant="outline"
          size="lg"
          onClick={closePicker}
          disabled={saving}
          style={{
            width: "100%",
            minWidth: 0,
            paddingInline: "12px",
          }}
        >
          Cancel
        </GamifyButton>

        <GamifyButton
          type="button"
          variant="primary"
          size="lg"
          onClick={() => void handleSave()}
          disabled={disabled || saving}
          style={{
            width: "100%",
            minWidth: 0,
            paddingInline: "12px",
          }}
        >
          Save
        </GamifyButton>
      </div>
    </dialog>
  </>
);
}
