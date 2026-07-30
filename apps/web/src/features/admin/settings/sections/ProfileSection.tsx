import { useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { User } from '@switchboard/shared';
import { Button, Field, Input, Select } from '../../../../ui/index.ts';
import { useAuth } from '../../../../auth/AuthProvider.tsx';
import { useToast } from '../../../../feedback/ToastProvider.tsx';
import { ApiError } from '../../../../api/index.ts';
import { initials } from '../../../../lib/format.ts';
import { getMyPreferences, patchMe } from '../../api.ts';

/*
 * Profile — the personal identity surface (spec D-A3..D-A7). Display name and
 * timezone are the only user-writable identity fields; email, role, and sign-in
 * are IdP-owned (internal SSO — Switchboard holds no passwords). Avatars are
 * generated initials by design; no image upload. "Download my data" exports the
 * signed-in user's profile + preferences as client-side JSON.
 */

const NAME_MAX = 80;

const FALLBACK_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'UTC',
] as const;

function timezoneOptions(current: string): string[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [...FALLBACK_TIMEZONES];
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

async function downloadMyData(user: User): Promise<void> {
  const preferences = await getMyPreferences().catch(() => null);
  const payload = { exportedAt: new Date().toISOString(), profile: user, preferences };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'switchboard-my-data.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ProfileSection(): JSX.Element {
  const { user, login } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [timezone, setTimezone] = useState(user?.timezone ?? 'America/New_York');

  const save = useMutation({
    mutationFn: () => patchMe({ name: name.trim(), timezone }),
    onSuccess: (updated) => {
      // Re-adopt the updated user: AuthProvider re-persists the mock session
      // blob and the top-bar chip re-renders — no extra plumbing.
      login(updated);
      toast('Profile saved');
    },
  });

  // /settings sits behind RequireAuth; this only guards the type.
  if (!user) return <section className="admin-section" aria-label="Profile" />;

  const trimmed = name.trim();
  const nameError =
    trimmed.length === 0
      ? 'Display name is required'
      : trimmed.length > NAME_MAX
        ? `Keep it under ${NAME_MAX} characters`
        : undefined;
  const dirty = trimmed !== user.name || timezone !== user.timezone;

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (nameError === undefined && dirty) save.mutate();
  };

  return (
    <section className="admin-section" aria-labelledby="admin-profile-title">
      <header className="admin-section__head">
        <h1 id="admin-profile-title" className="admin-section__title">
          Profile
        </h1>
        <p className="admin-section__desc">
          How you appear across Switchboard. Email, role, and sign-in are managed in the company
          identity provider.
        </p>
      </header>

      <form className="admin-stack admin-profile__form" onSubmit={onSubmit} noValidate>
        <div className="admin-profile__avatar-row">
          <span className="sb-avatar admin-profile__avatar" aria-hidden="true">
            {initials(trimmed.length > 0 ? trimmed : user.name)}
          </span>
          <p className="admin-profile__avatar-note">
            Avatars are your initials — they update with your display name. There is no image
            upload.
          </p>
        </div>

        <Field label="Display name" error={nameError}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Timezone" hint="Used for task due times and activity timestamps.">
          <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {timezoneOptions(user.timezone).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>

        {save.isError ? (
          <p role="alert" className="sb-field__error">
            {errorText(save.error)}
          </p>
        ) : null}

        <div>
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            disabled={!dirty || nameError !== undefined}
          >
            Save profile
          </Button>
        </div>
      </form>

      <h2 className="admin-section__subtitle">Sign-in &amp; account</h2>
      <dl className="admin-identity">
        <dt>Email</dt>
        <dd className="admin-mono">{user.email}</dd>
        <dt>Sign-in</dt>
        <dd>Company single sign-on (SSO)</dd>
        <dt>Role</dt>
        <dd>
          <span className="admin-chip" data-role={user.role}>
            {user.role}
          </span>
        </dd>
        <dt>Directory subject</dt>
        <dd className="admin-mono">{user.idpSubject}</dd>
      </dl>
      <p className="admin-section__desc">
        Password and two-factor settings live in the identity provider, not here. To change your
        email or deactivate this account, contact an admin.
      </p>

      <h2 className="admin-section__subtitle">Your data</h2>
      <p className="admin-section__desc">
        Download a copy of your profile and preferences as JSON.
      </p>
      <Button type="button" onClick={() => void downloadMyData(user)}>
        Download my data
      </Button>
    </section>
  );
}
