import { MessageModal } from "@/app/modals/messagemodal";
import { QuickCommandEditModal } from "@/app/view/quickcommands/quickcommands-modal";
import { AboutModal } from "./about";
import { UserInputModal } from "./userinputmodal";

const modalRegistry: { [key: string]: React.ComponentType<any> } = {
    [UserInputModal.displayName || "UserInputModal"]: UserInputModal,
    [AboutModal.displayName || "AboutModal"]: AboutModal,
    [MessageModal.displayName || "MessageModal"]: MessageModal,
    [QuickCommandEditModal.displayName || "QuickCommandEditModal"]: QuickCommandEditModal,
};

export const getModalComponent = (key: string): React.ComponentType<any> | undefined => {
    return modalRegistry[key];
};
