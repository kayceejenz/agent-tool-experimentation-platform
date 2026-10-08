'use client';
import { useEffect, useRef } from 'react';

// Multiple mounted dialogs share one scroll lock; closing one cannot unlock another.
let lockCount = 0;

let previousOverflow = '';

function lockScroll() {
	if (lockCount++ === 0) {
		previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
	}
	return () => {
		if (--lockCount === 0)
			document.body.style.overflow = previousOverflow;
	};
}

export function useModalDialog(enabled = true) {
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		if (!enabled) return;
		const element = dialog.current;
		if (!element) return;
		const unlock = lockScroll();
		if (!element.open) element.showModal();
		return () => {
			element.close();
			unlock();
		};
	}, [enabled]);
	return dialog;
}
