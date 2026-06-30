import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function TotpQrCode({ uri }: { uri: string }) {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(uri, { margin: 2, width: 200 }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (!dataUrl) {
    return (
      <div
        className="skeleton mx-auto h-[200px] w-[200px] rounded-lg"
        aria-hidden
      />
    );
  }

  return (
    <img
      src={dataUrl}
      alt="QR code 2FA"
      className="mx-auto rounded-lg border border-bastion-700 bg-white p-2"
      width={200}
      height={200}
    />
  );
}
