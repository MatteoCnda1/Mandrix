import type { PoolScope } from '@mandrix/shared';
import { GlobeHemisphereWest, ShieldCheck, UsersThree } from '@phosphor-icons/react';
import { useState } from 'react';
import { PrimaryBtn, Sheet } from '../components/ui';
import { sendToPool } from '../lib/data';
import { useUI } from '../lib/store';

const OPTS: { value: PoolScope; icon: typeof GlobeHemisphereWest; label: string; sub: string }[] = [
  { value: 'public', icon: GlobeHemisphereWest, label: 'Pool public', sub: 'Tous les joueurs de Mandrix peuvent tomber dessus.' },
  { value: 'friends', icon: UsersThree, label: 'Amis seulement', sub: 'Uniquement dans les salons de tes amis.' },
];

export function PoolSheet({ target }: { target: { postId?: string; shotId?: string } }) {
  const [scope, setScope] = useState<PoolScope>('public');
  const [busy, setBusy] = useState(false);
  const close = () => useUI.setState({ poolFor: null });
  return (
    <Sheet title="Envoyer dans le pool" onClose={close}>
      <p className="m-0 text-[0.9375rem] leading-[1.45] text-mute">Ce contenu pourra être tiré au sort comme image à légender dans Make It Friends.</p>
      {OPTS.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => setScope(o.value)}
            className="tap flex items-center gap-3 rounded-[26px] border-0 bg-soft p-3 text-left text-ink transition-shadow duration-300"
            style={{ boxShadow: `inset 0 0 0 2px ${scope === o.value ? '#0E76C6' : 'transparent'}` }}
          >
            <span className="grid h-[46px] w-[46px] flex-none place-items-center rounded-full bg-card">
              <Icon size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9375rem] font-bold">{o.label}</span>
              <span className="block text-[0.8125rem] text-mute">{o.sub}</span>
            </span>
          </button>
        );
      })}
      <div className="flex gap-2.5 px-1 text-[0.8125rem] leading-[1.45] text-mute">
        <ShieldCheck size={18} className="flex-none" />
        <span>Tu peux retirer ton contenu du pool à tout moment. Chaque image peut être signalée par les joueurs et sera alors retirée en attendant vérification.</span>
      </div>
      <PrimaryBtn
        tone="brand"
        className="h-[54px] flex-none text-base"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          if (await sendToPool(target, scope)) close();
          setBusy(false);
        }}
      >
        Envoyer
      </PrimaryBtn>
    </Sheet>
  );
}
