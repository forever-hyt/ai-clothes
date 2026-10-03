import Studio from './studio-client';

export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return <Studio initialView={view === 'privacy' || view === 'terms' ? view : 'studio'} contact={process.env.PRIVACY_CONTACT || ''} />;
}
