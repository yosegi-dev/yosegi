import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

// Same react-docgen-typescript cache collision as dom-passthrough-siblings.tsx, but
// matching the sweep's other measured case: Textarea (TextareaHTMLAttributes, renders
// <textarea>) getting wrongly labeled "input" because InputHTMLAttributes and
// TextareaHTMLAttributes both declare `disabled` / `placeholder` / `required` / ... and
// InputField below is declared first.
export interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
	label: string;
}

export function InputField({ label, ...rest }: InputFieldProps) {
	return <input aria-label={label} {...rest} />;
}

export interface TextAreaFieldProps
	extends TextareaHTMLAttributes<HTMLTextAreaElement> {
	label: string;
}

export function TextAreaField({ label, ...rest }: TextAreaFieldProps) {
	return <textarea aria-label={label} {...rest} />;
}
