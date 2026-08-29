import "./register_types"

export const needle_exported_files = [];
globalThis["needle:codegen_files"] = needle_exported_files;

document.addEventListener("DOMContentLoaded", () =>
{
	const needleEngine = document.querySelector("needle-engine");
	if(needleEngine && needleEngine.getAttribute("src") === null)
	{
		needleEngine.setAttribute("hash", "1684752175704");
		needleEngine.setAttribute("src", JSON.stringify(needle_exported_files));
	}
});

