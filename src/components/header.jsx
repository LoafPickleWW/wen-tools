import { Link } from "react-router-dom";

export const Header = () => {
    return (
        <header className="flex justify-center flex-col mx-auto">
            <Link className="text-2xl font-bold hover:text-pink-500 transition"
                to="/"
            >
                Evil Tools{" "}
            </Link>
            <p className="italic font-thin text-center text-lg -mt-2 mb-2">(ARC69)</p>
        </header>
    )
}