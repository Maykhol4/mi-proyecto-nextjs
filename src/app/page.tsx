'use client';

import dynamic from 'next/dynamic';

const HomeClient = dynamic(() => import('./home-client'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-100">
      <div className="text-center">
        <p className="text-muted-foreground">Cargando aplicación...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return <HomeClient />;
}
