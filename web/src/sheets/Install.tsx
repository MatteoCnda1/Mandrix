import { DotsThreeVertical, Export, PlusSquare } from '@phosphor-icons/react';
import { Sheet } from '../components/ui';
import { isIOS } from '../lib/push';
import { closeSheet } from '../lib/store';

export function InstallSheet() {
  const step = 'flex items-center gap-3 rounded-3xl bg-soft p-3 text-[0.9375rem]';
  const num = 'grid h-9 w-9 flex-none place-items-center rounded-full bg-ink text-sm font-extrabold text-inv';
  return (
    <Sheet title="Installer Mandrix" onClose={closeSheet}>
      <p className="m-0 text-[0.9375rem] leading-[1.45] text-mute">
        Ajoute Mandrix à ton écran d’accueil pour l’ouvrir comme une vraie appli et recevoir les notifications du déballage.
      </p>
      {isIOS() ? (
        <>
          <div className={step}>
            <span className={num}>1</span>
            <span className="flex-1">Dans Safari, touche le bouton Partager</span>
            <Export size={24} />
          </div>
          <div className={step}>
            <span className={num}>2</span>
            <span className="flex-1">Choisis « Sur l’écran d’accueil »</span>
            <PlusSquare size={24} />
          </div>
          <div className={step}>
            <span className={num}>3</span>
            <span className="flex-1">Ouvre Mandrix depuis l’icône, puis active les notifications dans Réglages</span>
          </div>
        </>
      ) : (
        <>
          <div className={step}>
            <span className={num}>1</span>
            <span className="flex-1">Ouvre le menu du navigateur</span>
            <DotsThreeVertical size={24} />
          </div>
          <div className={step}>
            <span className={num}>2</span>
            <span className="flex-1">Choisis « Installer l’application » ou « Ajouter à l’écran d’accueil »</span>
          </div>
        </>
      )}
    </Sheet>
  );
}
