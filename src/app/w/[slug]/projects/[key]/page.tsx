import { redirect } from "next/navigation";

export default async function ProjectIndex({ params }: PageProps<"/w/[slug]/projects/[key]">) {
  const { slug, key } = await params;
  redirect(`/w/${slug}/projects/${key}/board`);
}
