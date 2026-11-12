/** Wording required by Supercell's Fan Content Policy. Do not shorten. */
export const FAN_CONTENT_NOTICE =
  'This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.'

export function FanContentNotice({ className }: { className?: string }): React.JSX.Element {
  return (
    <p className={className} role="note">
      {FAN_CONTENT_NOTICE}
    </p>
  )
}
