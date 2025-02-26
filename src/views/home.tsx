import { SelectToolComponent } from "../components/SelectToolComponent";

export default function Home() {
  return (
    <div className="bg-primary-black pt-2 flex justify-center flex-col text-white pb-10">
      <main className="flex flex-col justify-center items-center mx-4 md:mx-10 rounded-lg">
        <SelectToolComponent />
      </main>
      <div className="flex flex-col mx-auto w-[80%] md:w-[90%] lg:w-[70%] py-8">
        <h2 className="text-2xl font-semibold text-center text-slate-100 mb-2 font-sans">
          partners
        </h2>
        <div className="partners_class flex flex-col md:flex-row justify-between items-center gap-6 md:gap-4  py-4">
          <a
            href="https://www.algorand.foundation?ref=eviltools"
            className="flex justify-center opacity-80 hover:opacity-100 transition"
            target="_blank noreferrer"
          >
            <img
              src="./af_logo.svg"
              alt="af"
              className="w-40 h-30 md:w-20 md:h-20"
            />
          </a>
          <a
            href="https://algoverify.me?ref=eviltools"
            className="flex justify-center text-center items-center opacity-80 text-3xl hover:opacity-100 transition font-sans font-semibold"
            target="_blank noreferrer"
          >
            AlgoVerify
          </a>
          <a
            href="https://nf.domains?ref=eviltools"
            className="flex justify-center items-center opacity-80 hover:opacity-100 transition"
            target="_blank noreferrer"
          >
            <svg viewBox="0 0 1260 400" fill="white" className="h-10 w-auto">
              <polygon points="430,0 430,66.7 430,133.3 430,200 430,266.7 430,400 630,400 630,266.7 730,266.7 730,200 730,133.3 830,133.3 830,66.7 830,0 630,0"></polygon>
              <polygon points="200,200 0,0 0,400 200,400 400,400 400,200 400,0 200,0"></polygon>
              <path d="M1060,0H860v200v200h200c110.5,0,200-89.5,200-200S1170.5,0,1060,0z"></path>
            </svg>
          </a>
          <a
            href="https://www.randgallery.com/algo-collection?ref=eviltools"
            className="flex justify-center opacity-80 hover:opacity-100 transition "
            target="_blank noreferrer"
          >
            <svg
              width="90"
              viewBox="0 0 560 560"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M80.0151 400V160H132.868V400H80.0151ZM222.783 400L156.01 297.948H214.02L284.015 400H222.783ZM118.688 323.696V281.631H176.698C184.432 281.631 191.093 280.109 196.679 277.066C202.48 273.805 206.884 269.348 209.892 263.696C213.115 257.827 214.726 251.087 214.726 243.479C214.726 235.87 213.115 229.24 209.892 223.587C206.884 217.718 202.48 213.261 196.679 210.218C191.093 206.957 184.432 205.327 176.698 205.327H118.688V160H172.508C192.059 160 209.033 163.044 223.427 169.131C237.822 175 248.887 183.805 256.622 195.544C264.356 207.283 268.224 222.066 268.224 239.892V245.109C268.224 262.718 264.249 277.392 256.299 289.131C248.565 300.653 237.5 309.348 223.105 315.218C208.925 320.87 192.412 323.696 172.861 323.696H118.688Z"
                fill="white"
              />
              <path
                d="M355.962 400C340.174 400 326.583 397.111 315.188 391.331C303.794 385.552 295.044 377.719 288.937 367.833C282.831 357.947 279.777 346.845 279.777 334.525C279.777 325.324 281.602 317.187 285.251 310.115C288.9 302.966 293.964 296.388 300.443 290.381C306.922 284.297 314.444 278.289 323.008 272.358L366.239 243.042C371.973 239.24 376.255 235.248 379.085 231.065C381.915 226.807 383.33 222.092 383.33 216.921C383.33 212.13 381.431 207.681 377.633 203.575C373.835 199.468 368.51 197.415 361.659 197.415C357.041 197.415 353.02 198.48 349.594 200.609C346.243 202.738 343.599 205.514 341.663 208.936C339.801 212.282 338.87 215.97 338.87 220C338.87 224.943 340.211 229.962 342.892 235.058C345.647 240.153 349.259 245.514 353.727 251.141C358.196 256.693 363.074 262.662 368.361 269.05L479.777 400H434.908L341.588 293.232C335.407 286.008 329.338 278.594 323.38 270.989C317.148 263.557 309.316 253.524 305.369 245.083C301.422 236.566 299.55 229.164 299.55 219.202C299.55 208.023 302.082 197.947 307.146 188.974C312.284 180 319.471 172.928 328.705 167.757C338.014 162.586 348.85 160 361.212 160C373.425 160 383.926 162.51 392.713 167.529C401.501 172.472 408.278 179.088 413.044 187.377C417.81 195.59 420.193 204.601 420.193 214.411C420.193 225.438 417.512 235.4 412.15 244.297C406.863 253.118 399.416 261.065 389.809 268.137L343.339 302.586C336.562 307.529 331.609 312.586 328.482 317.757C325.428 322.928 323.902 327.681 323.902 332.016C323.902 337.795 325.279 343.004 328.035 347.643C330.865 352.206 334.849 355.856 339.987 358.594C345.126 361.255 351.121 362.586 357.972 362.586C366.015 362.586 373.984 360.723 381.878 356.997C389.772 353.194 394.896 346.483 401.375 339.487C407.929 332.491 414.765 325.953 418.99 316.052C422.862 306.394 424.761 293.481 424.761 281.694H462.741C462.741 296.142 461.19 311.103 458.062 322.434C455.009 333.689 450.801 343.423 445.439 351.635C440.152 359.772 434.231 366.388 427.678 371.483C425.592 372.928 423.544 374.297 421.534 375.59C419.597 376.883 417.587 378.213 415.501 379.582C407.161 386.731 397.703 391.94 387.128 395.21C376.553 398.404 366.164 400 355.962 400Z"
                fill="white"
              />
            </svg>
          </a>
          <a
            href="https://apps.crust.network/?rpc=wss%3A%2F%2Frpc.crust.network#/explorer"
            className="flex justify-center opacity-80 hover:opacity-100 transition"
            target="_blank noreferrer"
          >
            <img
              src="./crust.png"
              alt="crust"
              className="w-40 h-30 md:w-40 md:h-20"
            />
          </a>
          <a
            href="https://mentalmarvin.art/"
            className="flex justify-center opacity-80 hover:opacity-100 transition"
            target="_blank noreferrer"
          >
            <img
              src="./sm-small.png"
              alt="crust"
              className="w-40 h-10 md:w-50 md:h-10"
            />
          </a>
        </div>
      </div>
    </div>
  );
}
