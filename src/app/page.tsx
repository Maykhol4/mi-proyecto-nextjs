import dynamic from 'next/dynamic'

const HomeClient = dynamic(() => import('./home-client'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen w-full flex items-center justify-center">
      <p>Cargando aplicación...</p>
    </div>
  ),
})

export default function Home() {
  return <HomeClient />
}
