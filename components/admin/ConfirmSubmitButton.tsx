"use client";

export default function ConfirmSubmitButton({
  confirmMessage,
  children,
  className,
  disabled,
}: {
  confirmMessage: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
