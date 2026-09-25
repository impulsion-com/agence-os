import { initials } from "@/lib/format";
import type { Profile } from "@/lib/types";

export function Avatar({ profile, size = 22, title = true }: { profile?: Pick<Profile, "full_name" | "color"> | null; size?: number; title?: boolean }) {
  if (!profile) return <span className="av empty" style={{ ["--s" as string]: `${size}px` }} aria-label="Non assigné" />;
  return (
    <span
      className="av"
      style={{ ["--s" as string]: `${size}px`, ["--c" as string]: profile.color }}
      title={title ? profile.full_name : undefined}
    >
      {initials(profile.full_name)}
    </span>
  );
}

export function AvatarStack({ profiles, max = 4, size = 22 }: { profiles: Pick<Profile, "full_name" | "color">[]; max?: number; size?: number }) {
  const shown = profiles.slice(0, max);
  const rest = profiles.length - shown.length;
  return (
    <span className="avs">
      {shown.map((p, i) => (
        <Avatar key={i} profile={p} size={size} />
      ))}
      {rest > 0 && (
        <span className="av" style={{ ["--s" as string]: `${size}px`, ["--c" as string]: "var(--gray)" }}>
          +{rest}
        </span>
      )}
    </span>
  );
}
