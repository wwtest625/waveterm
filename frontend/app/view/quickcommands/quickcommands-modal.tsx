// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useMemo, useState } from "react";

export type QuickCommandFormValue = {
    name: string;
    command?: string;
    description?: string;
};

type QuickCommandEditModalProps = {
    itemType: "group" | "command";
    title: string;
    confirmLabel?: string;
    initialValue?: QuickCommandFormValue;
    onSubmit: (value: QuickCommandFormValue) => boolean | void | Promise<boolean | void>;
};

const inputClassName =
    "w-full rounded border border-border bg-panel px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-accent";

function QuickCommandEditModal({ itemType, title, confirmLabel, initialValue, onSubmit }: QuickCommandEditModalProps) {
    const [name, setName] = useState(initialValue?.name ?? "");
    const [command, setCommand] = useState(initialValue?.command ?? "");
    const [description, setDescription] = useState(initialValue?.description ?? "");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isValid = useMemo(() => {
        if (name.trim() === "") {
            return false;
        }
        if (itemType === "command" && command.trim() === "") {
            return false;
        }
        return true;
    }, [command, itemType, name]);

    async function handleSubmit() {
        if (!isValid || submitting) {
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const result = await onSubmit({
                name: name.trim(),
                command,
                description: description.trim(),
            });
            if (result !== false) {
                modalsModel.popModal();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal
            className="pt-6 pb-4 px-5"
            onOk={() => handleSubmit()}
            onCancel={() => modalsModel.popModal()}
            onClose={() => modalsModel.popModal()}
            okLabel={confirmLabel ?? "保存"}
            cancelLabel="取消"
            okDisabled={!isValid || submitting}
        >
            <div className="mx-4 min-w-[440px] max-w-[560px] text-primary">
                <div className="pb-3 text-lg font-semibold">{title}</div>
                <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-secondary">名称</span>
                        <input className={inputClassName} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                    </label>
                    {itemType === "command" && (
                        <>
                            <label className="flex flex-col gap-1 text-sm">
                                <span className="text-secondary">命令</span>
                                <textarea
                                    className={`${inputClassName} min-h-[120px] resize-y font-mono`}
                                    value={command}
                                    onChange={(e) => setCommand(e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1 text-sm">
                                <span className="text-secondary">说明（可选）</span>
                                <textarea
                                    className={`${inputClassName} min-h-[70px] resize-y`}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                />
                            </label>
                        </>
                    )}
                    {error ? <div className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div> : null}
                </div>
            </div>
        </Modal>
    );
}

QuickCommandEditModal.displayName = "QuickCommandEditModal";

export { QuickCommandEditModal };