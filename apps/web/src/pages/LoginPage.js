import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
export function LoginPage() {
    const navigate = useNavigate();
    const { login, isAuthenticated } = useAuth();
    const [email, setEmail] = useState("admin@adfix.local");
    const [password, setPassword] = useState("ChangeMe123!");
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    useEffect(() => {
        if (isAuthenticated) {
            navigate("/dashboard");
        }
    }, [isAuthenticated, navigate]);
    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);
        setIsSubmitting(true);
        try {
            await login(email, password);
            navigate("/dashboard");
        }
        catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
            }
            else {
                setError("Login failed");
            }
        }
        finally {
            setIsSubmitting(false);
        }
    };
    return (_jsx("div", { className: "login-wrap", children: _jsxs("form", { className: "card login-card", onSubmit: handleSubmit, children: [_jsx("h1", { children: "Adfix PM" }), _jsx("p", { className: "muted", children: "Sign in to continue" }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Email" }), _jsx("input", { value: email, onChange: (event) => setEmail(event.target.value), type: "email", required: true })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Password" }), _jsx("input", { value: password, onChange: (event) => setPassword(event.target.value), type: "password", required: true })] }), error ? _jsx("p", { className: "error-text", children: error }) : null, _jsx("button", { className: "primary-button", type: "submit", disabled: isSubmitting, children: isSubmitting ? "Signing in..." : "Sign in" })] }) }));
}
