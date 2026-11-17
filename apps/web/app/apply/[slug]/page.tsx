import { ApplyPage } from "@/components/public-careers";
export default async function ApplyRoute({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; return <ApplyPage slug={slug} />; }
