import { ConsultingTargetList } from "./client";

type Props = {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ name?: string }>;
};

export default async function ConsultingTargetListPage({ params, searchParams }: Props) {
  const { profileId } = await params;
  const { name } = await searchParams;
  return (
    <ConsultingTargetList
      profileId={profileId}
      profileName={name?.trim() || "Consulting profile"}
    />
  );
}
