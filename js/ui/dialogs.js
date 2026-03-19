export function createDialogController({
    state,
    dialogModal,
    dialogTitle,
    dialogMessage,
    dialogCancelBtn,
    dialogConfirmBtn
}) {
    function processDialogQueue() {
        if (state.isDialogOpen || state.dialogQueue.length === 0) {
            return;
        }

        state.isDialogOpen = true;
        const dialog = state.dialogQueue.shift();
        dialogTitle.textContent = dialog.title;
        dialogMessage.textContent = dialog.message;

        if (dialog.type === 'confirm') {
            dialogCancelBtn.classList.remove('hidden');
            dialogConfirmBtn.textContent = 'Confirmar';
        } else {
            dialogCancelBtn.classList.add('hidden');
            dialogConfirmBtn.textContent = 'Aceptar';
        }

        dialogModal.classList.remove('hidden');
        state.currentDialogResolve = (result) => {
            dialogModal.classList.add('hidden');
            state.isDialogOpen = false;
            state.currentDialogResolve = null;
            dialog.resolve(dialog.type === 'alert' ? true : result);
            processDialogQueue();
        };
    }

    function enqueueDialog(title, message, type) {
        return new Promise((resolve) => {
            state.dialogQueue.push({ title, message, type, resolve });
            processDialogQueue();
        });
    }

    function closeDialog(result) {
        if (state.currentDialogResolve) {
            state.currentDialogResolve(result);
        }
    }

    function init() {
        dialogCancelBtn.addEventListener('click', () => closeDialog(false));
        dialogConfirmBtn.addEventListener('click', () => closeDialog(true));
        dialogModal.addEventListener('click', (event) => {
            if (event.target === dialogModal) {
                closeDialog(false);
            }
        });
    }

    return {
        init,
        confirm(title, message) {
            return enqueueDialog(title, message, 'confirm');
        },
        alert(title, message) {
            return enqueueDialog(title, message, 'alert');
        }
    };
}