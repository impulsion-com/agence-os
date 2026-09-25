import { SettingsShell } from "@/components/workspace/settings/shell";

export default function SettingsLayout({ children }: LayoutProps<"/w/[slug]/settings">) {
  return <SettingsShell>{children}</SettingsShell>;
}
