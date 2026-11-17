import { JobDetailPage } from "@/components/public-careers";
export default async function JobRoute({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; return <JobDetailPage slug={slug} />; }
