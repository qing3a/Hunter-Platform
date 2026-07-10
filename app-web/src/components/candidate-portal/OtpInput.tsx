import { useRef, useState, useEffect } from 'react';

interface OtpInputProps {
  length?: number;
  onChange?: (code: string) => void;
}

export function OtpInput({ length = 6, onChange }: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(''));
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    onChange?.(digits.join(''));
  }, [digits, onChange]);

  function handleChange(idx: number, value: string) {
    const v = value.replace(/\D/g, '').slice(0, 1);
    const newDigits = [...digits];
    newDigits[idx] = v;
    setDigits(newDigits);
    if (v && idx < length - 1) refs.current[idx + 1]?.focus();
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    const newDigits = pasted.split('').concat(Array(length).fill('')).slice(0, length);
    setDigits(newDigits);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  }

  return (
    <div className="cp-otp-input">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          autoFocus={i === 0}
          className="cp-otp-digit"
          aria-label={`OTP 第 ${i + 1} 位`}
        />
      ))}
    </div>
  );
}