import UserLogin from '@/components/user/UserLogin';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; verified?: string }> }) {
  const { next, verified } = await searchParams;
  return <UserLogin next={next ?? '/'} verified={verified === '1'} demoMode={process.env.DEMO_MODE === 'true'} />;
}
