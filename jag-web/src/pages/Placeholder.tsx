export default function Placeholder({ name }: { name: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">{name}</h1>
      <p className="text-slate-400">Coming soon.</p>
    </div>
  )
}
