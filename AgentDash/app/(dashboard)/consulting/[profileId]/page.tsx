import { ConsultingProfileClient } from "./client";

type Props = {
  params: Promise<{ profileId: string }>;
};

export default async function ConsultingProfilePage({ params }: Props) {
  const { profileId } = await params;
  return <ConsultingProfileClient profileId={profileId} />;
}
