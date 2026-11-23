import type { MediaRef, UserLite } from '@mandrix/shared';
import { UsersThree } from '@phosphor-icons/react';
import { Avatar } from './ui';

/** Avatar d'une conversation : la personne, la photo du groupe, ou deux avatars superposés. */
export function ConvAvatar({
  isGroup,
  user,
  members,
  photo,
  size = 48,
}: {
  isGroup: boolean;
  user: UserLite | null;
  members: UserLite[];
  photo?: MediaRef | null;
  size?: number;
}) {
  if (!isGroup && user) return <Avatar user={user} size={size} />;
  if (photo) return <img src={photo.url} alt="" className="flex-none rounded-full object-cover" style={{ width: size, height: size }} />;
  const [a, b] = members;
  if (!a) {
    return (
      <span className="grid flex-none place-items-center rounded-full bg-tint text-ink" style={{ width: size, height: size }}>
        <UsersThree size={size * 0.45} weight="fill" />
      </span>
    );
  }
  const s = Math.round(size * 0.7);
  return (
    <span className="relative flex-none" style={{ width: size, height: size }}>
      <Avatar user={a} size={s} className="absolute top-0 left-0" />
      {b && <Avatar user={b} size={s} className="absolute right-0 bottom-0 shadow-[0_0_0_2px_var(--card)]" />}
    </span>
  );
}
