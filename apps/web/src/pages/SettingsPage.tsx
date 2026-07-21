import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Clipboard, KeyRound, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { Panel } from "../components/ui/Panel";

type UserProfileResponse = {
  data: {
    id: string;
    email: string;
    name: string;
    avatar_url: string | null;
    is_active: boolean;
    is_admin: boolean;
  };
};

type TemporaryPasswordResponse = {
  data: {
    id: string;
    email: string;
    name: string;
    accountType: "staff" | "client";
    temporaryPassword: string;
    mustChangePassword: true;
  };
};

export function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, accessToken, updateLocalUser, logout } = useAuth();
  const passwordChangeRequired = Boolean(user?.mustChangePassword || searchParams.get("passwordChange") === "required");
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [temporaryCredential, setTemporaryCredential] = useState<TemporaryPasswordResponse["data"] | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["settings-profile", user?.id],
    queryFn: () => apiRequest<UserProfileResponse>(`/users/${user?.id}`, {
      accessToken: accessToken ?? undefined
    }),
    enabled: Boolean(user?.id && accessToken && !passwordChangeRequired)
  });

  useEffect(() => {
    if (!profileQuery.data?.data) return;
    setName(profileQuery.data.data.name);
    setAvatarUrl(profileQuery.data.data.avatar_url ?? "");
  }, [profileQuery.data]);

  const updateProfileMutation = useMutation({
    mutationFn: (payload: { name?: string; avatarUrl?: string | null }) =>
      apiRequest<UserProfileResponse>(`/users/${user?.id}`, {
        method: "PUT",
        accessToken: accessToken ?? undefined,
        body: payload
      }),
    onSuccess: (result) => {
      setProfileError(null);
      setProfileSuccess("Profile updated.");
      updateLocalUser({ name: result.data.name, avatarUrl: result.data.avatar_url });
    },
    onError: (error) => {
      setProfileError(error instanceof ApiError ? error.message : "Could not update profile.");
      setProfileSuccess(null);
    }
  });

  const changePasswordMutation = useMutation({
    mutationFn: () => apiRequest<void>("/users/me/change-password", {
      method: "POST",
      accessToken: accessToken ?? undefined,
      body: { currentPassword, newPassword }
    }),
    onSuccess: async () => {
      setPasswordError(null);
      await logout();
      navigate("/login?passwordChanged=1", { replace: true });
    },
    onError: (error) => {
      setPasswordError(error instanceof ApiError ? error.message : "Could not change password.");
    }
  });

  const issueTemporaryPasswordMutation = useMutation({
    mutationFn: () => apiRequest<TemporaryPasswordResponse>("/users/admin/password-reset", {
      method: "POST",
      accessToken: accessToken ?? undefined,
      body: { email: recoveryEmail.trim() }
    }),
    onSuccess: (result) => {
      setTemporaryCredential(result.data);
      setRecoveryError(null);
      setCopied(false);
    },
    onError: (error) => {
      setTemporaryCredential(null);
      setRecoveryError(error instanceof ApiError ? error.message : "Could not issue a temporary password.");
    }
  });

  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateProfileMutation.mutate({
      name: name.trim(),
      avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null
    });
  };

  const submitPasswordChange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setPasswordError(null);
    changePasswordMutation.mutate();
  };

  const copyTemporaryPassword = async () => {
    if (!temporaryCredential) return;
    await navigator.clipboard.writeText(temporaryCredential.temporaryPassword);
    setCopied(true);
  };

  return (
    <section>
      <PageHeader title="Settings" description="Manage your profile and account security." />

      {passwordChangeRequired ? (
        <div className="password-required-notice" role="alert">
          <ShieldCheck size={20} aria-hidden="true" />
          <div><strong>Choose a permanent password</strong><p>You are using a temporary password. Change it before entering the workspace.</p></div>
        </div>
      ) : null}

      <div className="settings-grid">
        <Panel title="Password" description="Changing your password signs out every active session.">
          <form className="ui-form settings-form" onSubmit={submitPasswordChange}>
            <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
            <label className="field"><span>New password</span><input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><small>At least 12 characters with uppercase, lowercase, and a number.</small></label>
            <label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
            {passwordError ? <p className="error-text" role="alert">{passwordError}</p> : null}
            <div><Button variant="primary" type="submit" icon={<KeyRound size={16} />} disabled={changePasswordMutation.isPending || !currentPassword || newPassword.length < 12 || !confirmPassword}>{changePasswordMutation.isPending ? "Changing..." : passwordChangeRequired ? "Set permanent password" : "Change password"}</Button></div>
          </form>
        </Panel>

        {!passwordChangeRequired ? (
          <Panel title="Profile" description="Your name and avatar across the workspace." className="settings-panel">
            <form className="ui-form settings-form" onSubmit={submitProfile}>
              {profileQuery.isLoading ? <p>Loading profile...</p> : null}
              {profileQuery.isError ? <p className="error-text">Could not load profile.</p> : null}
              <label className="field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
              <label className="field"><span>Avatar URL</span><input placeholder="https://..." value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} /></label>
              <div><Button variant="primary" type="submit" disabled={updateProfileMutation.isPending}>{updateProfileMutation.isPending ? "Saving..." : "Save changes"}</Button></div>
              {profileError ? <p className="error-text" role="alert">{profileError}</p> : null}
              {profileSuccess ? <p className="success-text" role="status">{profileSuccess}</p> : null}
            </form>
          </Panel>
        ) : null}

        {user?.isAdmin && !passwordChangeRequired ? (
          <Panel title="Account recovery" description="Issue a one-time temporary password to an active staff or client account.">
            <form className="ui-form settings-form" onSubmit={(event) => { event.preventDefault(); issueTemporaryPasswordMutation.mutate(); }}>
              <label className="field"><span>Account email</span><input type="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} placeholder="person@example.com" required /></label>
              <p className="form-guidance">All existing sessions will be revoked. The person must replace the temporary password at their next sign-in.</p>
              {recoveryError ? <p className="error-text" role="alert">{recoveryError}</p> : null}
              <div><Button variant="secondary" type="submit" icon={<ShieldCheck size={16} />} disabled={!recoveryEmail.trim() || issueTemporaryPasswordMutation.isPending}>{issueTemporaryPasswordMutation.isPending ? "Issuing..." : "Issue temporary password"}</Button></div>
            </form>
            {temporaryCredential ? (
              <div className="temporary-credential" role="status">
                <div><strong>Temporary password for {temporaryCredential.name}</strong><p>Copy it now. It is shown only in this response and is not recoverable later.</p></div>
                <div className="temporary-credential-value"><code>{temporaryCredential.temporaryPassword}</code><Button size="sm" variant="secondary" icon={copied ? <Check size={15} /> : <Clipboard size={15} />} onClick={() => void copyTemporaryPassword()}>{copied ? "Copied" : "Copy"}</Button></div>
              </div>
            ) : null}
          </Panel>
        ) : null}
      </div>
    </section>
  );
}
