import { redirect } from "next/navigation";

export default async function Settings({ params }: PageProps<"/w/[slug]/settings">) {
  const { slug } = await params;
  redirect(`/w/${slug}/settings/profile`);
}
