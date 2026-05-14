import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useCallback, useRef, useState } from "react";

interface PromptModalProps {
    title: string;
    label?: string;
    placeholder?: string;
    defaultValue?: string;
    onConfirm: (value: string | null) => void;
}

const PromptModal = ({ title, label, placeholder, defaultValue, onConfirm }: PromptModalProps) => {
    const [value, setValue] = useState(defaultValue ?? "");
    const inputRef = useRef<HTMLInputElement>(null);

    const handleConfirm = useCallback(() => {
        onConfirm(value);
        modalsModel.popModal();
    }, [value, onConfirm]);

    const handleCancel = useCallback(() => {
        onConfirm(null);
        modalsModel.popModal();
    }, [onConfirm]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
                e.preventDefault();
                handleConfirm();
            } else if (e.key === "Escape") {
                e.preventDefault();
                handleCancel();
            }
        },
        [handleConfirm, handleCancel]
    );

    return (
        <Modal
            className="message-modal"
            onOk={handleConfirm}
            onCancel={handleCancel}
            onClose={handleCancel}
            okLabel="确定"
            cancelLabel="取消"
        >
            <div className="flex flex-col gap-3 mx-4 max-w-[500px]">
                <div className="font-bold text-primary">{title}</div>
                {label && <div className="text-sm text-secondary">{label}</div>}
                <input
                    ref={inputRef}
                    type="text"
                    className="resize-none bg-panel rounded-md border border-border py-1.5 pl-4 min-h-[30px] text-inherit cursor-text focus:ring-2 focus:ring-accent focus:outline-none"
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                />
            </div>
        </Modal>
    );
};

PromptModal.displayName = "PromptModal";

interface ConfirmModalProps {
    title: string;
    message?: string;
    okLabel?: string;
    cancelLabel?: string;
    onResult: (confirmed: boolean) => void;
}

const ConfirmModal = ({ title, message, okLabel, cancelLabel, onResult }: ConfirmModalProps) => {
    const handleOk = useCallback(() => {
        onResult(true);
        modalsModel.popModal();
    }, [onResult]);

    const handleCancel = useCallback(() => {
        onResult(false);
        modalsModel.popModal();
    }, [onResult]);

    return (
        <Modal
            className="message-modal"
            onOk={handleOk}
            onCancel={handleCancel}
            onClose={handleCancel}
            okLabel={okLabel ?? "确定"}
            cancelLabel={cancelLabel ?? "取消"}
        >
            <div className="flex flex-col gap-3 mx-4 max-w-[500px]">
                <div className="font-bold text-primary">{title}</div>
                {message && <div className="text-sm text-secondary">{message}</div>}
            </div>
        </Modal>
    );
};

ConfirmModal.displayName = "ConfirmModal";

export function showPromptModal(opts: {
    title: string;
    label?: string;
    placeholder?: string;
    defaultValue?: string;
}): Promise<string | null> {
    return new Promise((resolve) => {
        modalsModel.pushModal("PromptModal", {
            ...opts,
            onConfirm: resolve,
        });
    });
}

export function showConfirmModal(opts: {
    title: string;
    message?: string;
    okLabel?: string;
    cancelLabel?: string;
}): Promise<boolean> {
    return new Promise((resolve) => {
        modalsModel.pushModal("ConfirmModal", {
            ...opts,
            onResult: resolve,
        });
    });
}

export { ConfirmModal, PromptModal };
