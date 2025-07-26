'use client';

import dynamic from 'next/dynamic';

// Al cargar home-client de forma dinámica con ssr:false,
// aseguramos que nada de su contenido (incluyendo sus importaciones)
// se ejecute en el servidor.
const HomeClient = dynamic(() => import('./home-client'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-100">
      <p className="text-gray-500">Cargando aplicación...</p>
    </div>
  ),
});

export default function Home() {
  return <HomeClient />;
}
