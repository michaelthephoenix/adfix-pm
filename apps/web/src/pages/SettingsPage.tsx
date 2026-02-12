import { useMutation, useQuery } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";

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

export function SettingsPage() {
  const { user, accessToken, updateLocalUser } = useAuth();
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["settings-profile", user?.id],
    queryFn: () =>
      apiRequest<UserProfileResponse>(`/users/${user?.id}`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(user?.id && accessToken)
  });

  useEffect(() => {
    if (!profileQuery.data?.data) return;
    setName(profileQuery.data.data.name);
    setAvatarUrl(profileQuery.data.data.avatar_url ?? "");
    updateLocalUser({
      name: profileQuery.data.data.name,
      avatarUrl: profileQuery.data.data.avatar_url
    });
  }, [profileQuery.data, updateLocalUser]);

  const updateProfileMutation = useMutation({
    mutationFn: (payload: { name?: string; avatarUrl?: string | null }) =>
      apiRequest<UserProfileResponse>(`/users/${user?.id}`, {
        method: "PUT",
        accessToken: accessToken ?? undefined,
        body: payload
      }),
    onSuccess: (result) => {
      setError(null);
      setSuccess("Profile updated.");
      updateLocalUser({
        name: result.data.name,
        avatarUrl: result.data.avatar_url
      });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Could not update profile.");
      }
      setSuccess(null);
    }
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateProfileMutation.mutate({
      name: name.trim(),
      avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null
    });
  };

  return (
    <section>
      <div className="section-head">
        <h2>Settings</h2>
      </div>
      <form className="card task-create-form" onSubmit={onSubmit}>
        <h3>Profile</h3>
        {profileQuery.isLoading ? <p>Loading profile...</p> : null}
        {profileQuery.isError ? <p className="error-text">Could not load profile.</p> : null}
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="field">
          <span>Avatar URL</span>
          <input
            placeholder="https://..."
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
          />
        </label>
        <button className="primary-button" type="submit" disabled={updateProfileMutation.isPending}>
          Save profile
        </button>
        {error ? <p className="error-text">{error}</p> : null}
        {success ? <p className="muted">{success}</p> : null}
      </form>
    </section>
  );
}
