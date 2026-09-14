type PlaceholderPageProps = {
  title: string
  description: string
}

export function PlaceholderPage({
  title,
  description
}: PlaceholderPageProps): React.JSX.Element {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted">{description}</p>
    </div>
  )
}
