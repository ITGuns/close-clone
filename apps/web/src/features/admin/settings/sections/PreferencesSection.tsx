import type { JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorState, Field, Input, Skeleton, Switch } from '../../../../ui/index.ts';
import { useTheme } from '../../../../theme/ThemeProvider.tsx';
import { THEME_CHOICES, type ThemeChoice } from '../../../../theme/theme.ts';
import { useToast } from '../../../../feedback/ToastProvider.tsx';
import { ApiError } from '../../../../api/index.ts';
import { getMyPreferences, patchMyPreferences } from '../../api.ts';
import { MY_PREFERENCES_QUERY_KEY } from '../../queryKeys.ts';
import type { UserPreferences, UserPreferencesPatch } from '../../types.ts';

/*
 * Preferences — personal, per-user settings (spec D-A9/D-A11/D-A12). Theme is
 * device-local (`sb-theme`, same store as the top-bar toggle); notification
 * preferences are server-persisted. The switches are the real interactive
 * Switch primitive (immediate effect), UNLIKE the Compliance section's
 * decorative glyphs — these settings genuinely belong to the user. The
 * personal "Notification quiet hours" are firewalled in copy from the I-QUIET
 * outbound compliance rail, which this section must never appear to control.
 */

const THEME_LABELS: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match system',
};

function loadErrorText(err: unknown): string {
  return err instanceof ApiError ? `${err.message} (${err.code})` : 'Something went wrong.';
}

export function PreferencesSection(): JSX.Element {
  const { choice, setChoice } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const prefsQuery = useQuery({
    queryKey: MY_PREFERENCES_QUERY_KEY,
    queryFn: ({ signal }) => getMyPreferences(signal),
  });

  const save = useMutation({
    mutationFn: (patch: UserPreferencesPatch) => patchMyPreferences(patch),
    onSuccess: (updated) =>
      queryClient.setQueryData<UserPreferences>(MY_PREFERENCES_QUERY_KEY, updated),
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Couldn’t save that preference.'),
  });

  const prefs = prefsQuery.data;

  return (
    <section className="admin-section" aria-labelledby="admin-preferences-title">
      <header className="admin-section__head">
        <h1 id="admin-preferences-title" className="admin-section__title">
          Preferences
        </h1>
        <p className="admin-section__desc">
          Personal settings. They follow you, not the workspace.
        </p>
      </header>

      <fieldset className="admin-fieldset">
        <legend className="admin-section__subtitle">Theme</legend>
        <div className="admin-radio-row">
          {THEME_CHOICES.map((themeChoice) => (
            <label key={themeChoice} className="admin-radio">
              <input
                type="radio"
                name="theme-choice"
                value={themeChoice}
                checked={choice === themeChoice}
                onChange={() => setChoice(themeChoice)}
              />
              {THEME_LABELS[themeChoice]}
            </label>
          ))}
        </div>
        <p className="sb-field__hint">Applies to this browser on this device.</p>
      </fieldset>

      <h2 className="admin-section__subtitle">Notifications</h2>
      <p className="admin-section__desc">
        Your own notifications only. Outbound quiet hours for calls, email, and SMS are a compliance
        rail enforced by the engine — see Compliance.
      </p>

      {prefsQuery.isLoading ? (
        <div className="admin-stack" aria-hidden="true">
          <Skeleton height={36} />
          <Skeleton height={36} />
          <Skeleton height={36} />
        </div>
      ) : prefsQuery.isError || prefs === undefined ? (
        <ErrorState
          title="Couldn’t load preferences"
          description={loadErrorText(prefsQuery.error)}
          onRetry={() => void prefsQuery.refetch()}
        />
      ) : (
        <div className="admin-stack">
          <div className="admin-prefs-row">
            <Switch
              label="Desktop notifications"
              checked={prefs.desktopNotifications}
              onCheckedChange={(checked) => save.mutate({ desktopNotifications: checked })}
            />
          </div>
          <div className="admin-prefs-row">
            <Switch
              label="Daily email digest"
              checked={prefs.emailDigest}
              onCheckedChange={(checked) => save.mutate({ emailDigest: checked })}
            />
          </div>
          <div className="admin-prefs-row">
            <Switch
              label="Notification quiet hours"
              checked={prefs.quietHours.enabled}
              onCheckedChange={(checked) =>
                save.mutate({ quietHours: { ...prefs.quietHours, enabled: checked } })
              }
            />
          </div>
          {prefs.quietHours.enabled ? (
            <div className="admin-prefs-times">
              <Field label="From" hint="Notifications pause at this time.">
                <Input
                  type="time"
                  value={prefs.quietHours.start}
                  onChange={(e) => {
                    if (e.target.value) {
                      save.mutate({ quietHours: { ...prefs.quietHours, start: e.target.value } });
                    }
                  }}
                />
              </Field>
              <Field label="Until">
                <Input
                  type="time"
                  value={prefs.quietHours.end}
                  onChange={(e) => {
                    if (e.target.value) {
                      save.mutate({ quietHours: { ...prefs.quietHours, end: e.target.value } });
                    }
                  }}
                />
              </Field>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
