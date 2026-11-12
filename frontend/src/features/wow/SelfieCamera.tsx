import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * A selfie for the writer's photo: asks for the front camera, shows a live
 * (mirrored) preview, takes a still, and hands it back as a JPEG File.
 *
 * Where the browser cannot open a camera (no device, permission refused, an
 * insecure page), it falls back to the phone's own camera app through a file
 * input with `capture="user"` — on a computer that is the ordinary file picker.
 */
export function SelfieCamera({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const { language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const bodyCls = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'starting' | 'live' | 'shot' | 'error'>('starting');
  const [shot, setShot] = useState<{ file: File; preview: string } | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setState('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setState('live');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    void start();
    return stop;
  }, [open, start, stop]);

  useEffect(() => () => (shot ? URL.revokeObjectURL(shot.preview) : undefined), [shot]);

  const take = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Save the photo the way the person saw themselves in the preview.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `selfie-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setShot({ file, preview: URL.createObjectURL(file) });
        setState('shot');
        stop();
      },
      'image/jpeg',
      0.9,
    );
  };

  const retake = () => {
    setShot(null);
    void start();
  };

  const close = () => {
    stop();
    setShot(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={L('సెల్ఫీ తీయండి', 'Take a selfie')}
      description={L('ముఖం స్పష్టంగా, వెలుతురులో కనిపించేలా.', 'Face the light so your face shows clearly.')}
      size="sm"
    >
      <div className="space-y-4">
        <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-pill bg-ink ring-4 ring-wow/70">
          {state === 'shot' && shot ? (
            <img src={shot.preview} alt={L('మీ సెల్ఫీ', 'Your selfie')} className="h-full w-full object-cover" />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label={L('కెమెరా ప్రివ్యూ', 'Camera preview')}
              className={cn('h-full w-full -scale-x-100 object-cover', state !== 'live' && 'opacity-0')}
            />
          )}
          {state === 'starting' ? (
            <p className={cn(bodyCls, 'absolute inset-0 flex items-center justify-center p-6 text-center text-on-ink/80')}>
              {L('కెమెరా తెరుస్తున్నాం… అనుమతి అడిగితే "అనుమతించు" నొక్కండి.', 'Opening the camera… allow access if your browser asks.')}
            </p>
          ) : null}
          {state === 'error' ? (
            <p className={cn(bodyCls, 'absolute inset-0 flex items-center justify-center p-6 text-center text-on-ink')}>
              {L(
                'కెమెరా తెరవలేకపోయాం. అనుమతి ఇవ్వండి లేదా కింది బటన్‌తో ఫొటో తీయండి / ఎంచుకోండి.',
                'Could not open the camera. Allow access, or use the button below to take or choose a photo.',
              )}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {state === 'live' ? (
            <Button variant="wow" size="lg" icon={Camera} onClick={take}>
              {L('ఫొటో తీయండి', 'Take photo')}
            </Button>
          ) : null}
          {state === 'shot' && shot ? (
            <>
              <Button variant="secondary" icon={RotateCcw} onClick={retake}>
                {L('మళ్లీ తీయండి', 'Retake')}
              </Button>
              <Button
                variant="wow"
                onClick={() => {
                  onCapture(shot.file);
                  setShot(null);
                  onClose();
                }}
              >
                {L('ఈ ఫొటో వాడండి', 'Use this photo')}
              </Button>
            </>
          ) : null}
          {state === 'error' ? (
            <>
              <Button variant="wow" icon={ImagePlus} onClick={() => fallbackRef.current?.click()}>
                {L('ఫొటో తీయండి / ఎంచుకోండి', 'Take or choose a photo')}
              </Button>
              <Button variant="secondary" icon={RotateCcw} onClick={() => void start()}>
                {L('మళ్లీ ప్రయత్నించండి', 'Try again')}
              </Button>
            </>
          ) : null}
        </div>
        <input
          ref={fallbackRef}
          type="file"
          accept="image/*"
          capture="user"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            onCapture(file);
            close();
          }}
        />
      </div>
    </Dialog>
  );
}
