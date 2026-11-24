// Print files from public GitHub repositories that practice projects load into 3D Studio.
// The desktop process downloads only the files listed here, from the pinned commit, and checks
// each one against its git blob id before using it; the interface asks for a set by key.
// Downloads are kept in the app's data folder, so a project starts offline the second time.
// Generated from the GitHub API trees on 2026-11-22.

export interface RemoteModelFile {
  /** Path in the repository. */
  path: string;
  /** Size in bytes. */
  size: number;
  /** Git blob id (SHA-1 of "blob <size>\0" + the file). */
  sha: string;
  /** For a ZIP file: the folders inside it whose .stl files are loaded. */
  unzip?: string[];
}

export interface RemoteModel {
  name: string;
  /** owner/name on GitHub. */
  repo: string;
  /** Full commit id the files are taken from. */
  commit: string;
  files: RemoteModelFile[];
}

export const REMOTE_MODELS: Record<string, RemoteModel> = {
  "sesame": {
    name: "Sesame printed parts", repo: "dorianborian/sesame-robot", commit: "449ad1e237fa419f575ea1bb183716134e02310c",
    files: [
      { path: "hardware/printing/stl/Bottom-Cover-v121.stl", size: 85184, sha: "12a134b1242c853847e8a3e509b003dd40baacc9" },
      { path: "hardware/printing/stl/Internal-Frame-v121.stl", size: 389084, sha: "73ac6caa55ffdbb0f92806dfb6e7cef364d129af" },
      { path: "hardware/printing/stl/L1-v117.stl", size: 359384, sha: "d524e0e8cefd7acfad283c5bc12099606753518c" },
      { path: "hardware/printing/stl/L2-v117.stl", size: 383384, sha: "93b935a55bc927b88aa81be70504b1cb4763b1d8" },
      { path: "hardware/printing/stl/L3-v117.stl", size: 102684, sha: "7fcafeb7faac60cde3f6fd140cce0bfeea977a04" },
      { path: "hardware/printing/stl/L4-v117.stl", size: 91384, sha: "a0912f6817bf89a30c29b9eaae053d2278d0950f" },
      { path: "hardware/printing/stl/R1-v117.stl", size: 379784, sha: "56116865753791974902f604997f8ac5ca6af979" },
      { path: "hardware/printing/stl/R2-v117.stl", size: 378984, sha: "08b88204b1f7482e8417527085d065970667c5d0" },
      { path: "hardware/printing/stl/R3-v117.stl", size: 105884, sha: "ba6168d833bb57bee1f0dbb0b3da9e4984c7cf8b" },
      { path: "hardware/printing/stl/R4-v117.stl", size: 94584, sha: "ba4b3cf9b77415deb2dd25c16ddff6c38d367a09" },
      { path: "hardware/printing/stl/top-covers/Top-Cover-Enclosed-v117.stl", size: 184184, sha: "6310e1364d1a8f67b2f7a020c025d6790e7213a2" },
    ],
  },
  "stack-chan": {
    name: "Stack-chan case (SG90 servo version)", repo: "stack-chan/stack-chan", commit: "9ca615119bc6f8222ae712e15a1aa571af27d5a2",
    files: [
      { path: "case/case_SG90/bracket_SG90_b.stl", size: 227684, sha: "734185233d46f73f62d1c49b332ee27b07d823a9" },
      { path: "case/case_SG90/bracket_SG90_f.stl", size: 271984, sha: "eb63688341612b1311d3362f1e54ff2bcdff65ca" },
      { path: "case/case_SG90/feet_SG90.stl", size: 476284, sha: "f9d35ab8b8e183d64ce563f081e257ffa0d5e190" },
      { path: "case/case_SG90/shell_SG90.stl", size: 790684, sha: "3daec990230f12c7ad293912bf4235326cc4587b" },
    ],
  },
  "openbot": {
    name: "OpenBot DIY body and phone mount", repo: "ob-f/OpenBot", commit: "52f2b2a91660eee499ab667bbc89342e6962aec6",
    files: [
      { path: "body/diy/cad/regular_body/body_bottom.stl", size: 3382384, sha: "baed65e4d47ce76a2f2902abb7a693f099f4396f" },
      { path: "body/diy/cad/regular_body/body_top.stl", size: 2972284, sha: "afb9d5f84f4ee363d013e2038d695ec37b3906ae" },
      { path: "body/phone_mount/phone_mount_bottom.stl", size: 264884, sha: "4f3b23d84ec499e9c5a1b94c366ac94c651cd309" },
      { path: "body/phone_mount/phone_mount_tilt_base.stl", size: 196984, sha: "c8631b2cca1d27dca11ea628705fe648e5d7d44d" },
      { path: "body/phone_mount/phone_mount_tilt_column.stl", size: 154884, sha: "f4d85098dfb6b91aaa89cf5ec6a23d8a2a64ba25" },
      { path: "body/phone_mount/phone_mount_top.stl", size: 187284, sha: "66783ee0975bfc1c2eccf850306561855739d0b9" },
    ],
  },
  "so-arm": {
    name: "SO-101 arm parts", repo: "TheRobotStudio/SO-ARM100", commit: "141aea7bcac2744d92998e30268c413202a56f96",
    files: [
      { path: "STL/SO101/Individual/Base_motor_holder_SO101.stl", size: 340884, sha: "80045f1052c352af8c4b47ef05643ef169e872dc" },
      { path: "STL/SO101/Individual/Base_SO101.stl", size: 477984, sha: "5547cc71c478d34e6bee6973d8b09f9f8cb41292" },
      { path: "STL/SO101/Individual/Handle_SO101.stl", size: 561084, sha: "d45f8c04839d419056db33c50ad34128108b9731" },
      { path: "STL/SO101/Individual/Motor_holder_SO101_Base.stl", size: 292784, sha: "2bdae17b7e53578d578d2866982125c24413986b" },
      { path: "STL/SO101/Individual/Motor_holder_SO101_Wrist.stl", size: 400584, sha: "eca7d25d1502895f1a6b252f8ddd79547d27ce7f" },
      { path: "STL/SO101/Individual/Moving_Jaw_SO101.stl", size: 563084, sha: "78d8cc42fe68b6840390cf60cac09540fecb7bb1" },
      { path: "STL/SO101/Individual/Rotation_Pitch_SO101.stl", size: 334884, sha: "0c994930dbc6df4c8d6d60a803d4ee148599b7bf" },
      { path: "STL/SO101/Individual/Seeedstudio_Mounting_Plate_SO101.stl", size: 97684, sha: "62ca9fe5e8a16d9dc44f9644de48eb6fd424dd4e" },
      { path: "STL/SO101/Individual/Trigger_SO101.stl", size: 448084, sha: "147cf29781dfcd4f2963123790a80c50bb06a080" },
      { path: "STL/SO101/Individual/Under_arm_SO101.stl", size: 525484, sha: "d7852a7804b58c893b26d0258b62f45f50dd8b02" },
      { path: "STL/SO101/Individual/Upper_arm_SO101.stl", size: 401984, sha: "2fcfd22d60fdc4055baa003235e3d83ec7754ba2" },
      { path: "STL/SO101/Individual/WaveShare_Mounting_Plate_SO101.stl", size: 37684, sha: "fcd09913c1b5d70cb7fd22dff93cdb1fe463944b" },
      { path: "STL/SO101/Individual/Wrist_Roll_Follower_SO101.stl", size: 602884, sha: "5e3ff9095827bb0abace8b29cb7ed9921b21fe32" },
      { path: "STL/SO101/Individual/Wrist_Roll_Pitch_SO101.stl", size: 851884, sha: "076ed76c940ad89820182d2a108f6e151833bdbe" },
      { path: "STL/SO101/Individual/Wrist_Roll_SO101.stl", size: 307984, sha: "234d0bc78bdd78f9b47836e0c6b44f471f1968c6" },
    ],
  },
  "moveo": {
    name: "Moveo arm parts", repo: "BCN3D/BCN3D-Moveo", commit: "0866a92501277636f76000a195d8a16d44b5b476",
    files: [
      { path: "STL files/Articulation 1/1M1.STL", size: 416484, sha: "8e76a3e1006380f5d089d549fa3d2ebf739ca79a" },
      { path: "STL files/Articulation 1/1M2.STL", size: 873684, sha: "46b816f0430620b984951b5e73c4a6bcabaec088" },
      { path: "STL files/Articulation 1/1M3.STL", size: 8905484, sha: "2020f6288fbfc99db768aeaf73a0ebbaad4f81f7" },
      { path: "STL files/Articulation 2/2M1.STL", size: 12145584, sha: "13641df3017092efa361c72988f06caa2488ae9c" },
      { path: "STL files/Articulation 2/2M2H.STL", size: 2674484, sha: "26d905f1f1c70712a642a0ef12184f5ebc21ed8a" },
      { path: "STL files/Articulation 2/2M2M.STL", size: 833384, sha: "5e5e23a4b882412db2cdc303b33d23d15d5d016a" },
      { path: "STL files/Articulation 2/T2M1BD.stl", size: 242184, sha: "0e758d565259ae97ef6f94aa9f3e7b37c3b12222" },
      { path: "STL files/Articulation 2/T2M1BI.stl", size: 259884, sha: "b5f708265edb2d481ab10616faa8b06622e3e1e9" },
      { path: "STL files/Articulation 3/3M1.STL", size: 3565184, sha: "45d88fb8707c7ec0a2ae44e6d4f791a25c098bff" },
      { path: "STL files/Articulation 3/3M2.STL", size: 2153084, sha: "444644c41a6879e4aa6983274d374a4b69f2e0ff" },
      { path: "STL files/Articulation 3/3M2C.STL", size: 2027084, sha: "859ea69b619f4ea3f7ecdd5b171b41319d00e8d2" },
      { path: "STL files/Articulation 3/T3M1C.stl", size: 200884, sha: "4802bfb6488278756aa827937c20064b808e4da2" },
      { path: "STL files/Articulation 4/4M1.STL", size: 6703284, sha: "8e001f9160289967337296e928465bc26cc9ef7a" },
      { path: "STL files/Articulation 4/4M2.STL", size: 523484, sha: "4fc317318b8be3641f852a1a3a00df10a13af273" },
      { path: "STL files/Articulation 4/4M2C.STL", size: 412584, sha: "f8ff45216aa320ca121392d4222a0100f68c4056" },
      { path: "STL files/Articulation 4/T4M1E.stl", size: 301184, sha: "37e92556299cb657ec355c7098d84c954faa486c" },
      { path: "STL files/Base/Potes.STL", size: 15684, sha: "f06ef64349f3b8f571826f23400d6a157afd1386" },
      { path: "STL files/Cover/Tapa 2M1.STL", size: 243484, sha: "b696c3b519847d3ba79e39e9b14548c983bf6af5" },
      { path: "STL files/Cover/Tapa 3M1.STL", size: 261484, sha: "6a2a1970b7dcff00a0113e734f5b994ceba5a973" },
      { path: "STL files/Cover/Tapa 4M1.STL", size: 260184, sha: "d6df20d1bf3ca6b091cb1b1e36c5e4c5a066196b" },
      { path: "STL files/Cover/Tapa TBB.STL", size: 541484, sha: "851e86489c4822fac8130027294c9bd55106b84c" },
      { path: "STL files/Electronics box/Box.STL", size: 25784284, sha: "85b324a09622e8e6ab819a6df2773d0c1770d49b" },
      { path: "STL files/Electronics box/Fan Module.STL", size: 859084, sha: "f45015f908470502afef3b8af06da71a20f4d4ee" },
      { path: "STL files/Electronics box/Suport Drivers.STL", size: 602084, sha: "42b6ee56fcfcb507826d5882967954f16eed3a53" },
      { path: "STL files/Machine - tool/Bottom Plate.STL", size: 2483784, sha: "4aceea7367ea589cebb6aa7915adb43b8fc3e4e1" },
      { path: "STL files/Machine - tool/Cilinder.STL", size: 36084, sha: "fe689b3e3ccdcbafa180a365d848dae27a69289f" },
      { path: "STL files/Machine - tool/Gripper Left.STL", size: 1879384, sha: "dc22d76ada5c99b72ba06b328e61e67ee3939da5" },
      { path: "STL files/Machine - tool/Gripper Right.STL", size: 1879284, sha: "9d2a522cff6d8e96cb1a7790cf7df569d43475fd" },
      { path: "STL files/Machine - tool/Idol Gear.STL", size: 2943884, sha: "22e5fc046eb0be68a6d7a214bb730ec39c39732f" },
      { path: "STL files/Machine - tool/Pivot Arm.STL", size: 750484, sha: "832416f203c19fb50ff3ee9b7f1e5dcce079d702" },
      { path: "STL files/Machine - tool/Servo Gear.STL", size: 2834484, sha: "77fab565dbb38aed85539ede2e959a9f65131752" },
      { path: "STL files/Machine - tool/Top Plate.STL", size: 997984, sha: "7eb7b3f42d806c21d5edbae96f03c3370c43cd7a" },
    ],
  },
  "spotmicro": {
    name: "Spot Micro frame (the repo's 3D models)", repo: "mike4192/spotMicro", commit: "2a34f5d303dff91b62180031b31ef512a672f3c3",
    files: [
      { path: "spot_micro_rviz/urdf/stl/backpart.stl", size: 435884, sha: "375dad5a67bfcf951e9d7721b6476777efc6aef2" },
      { path: "spot_micro_rviz/urdf/stl/foot.stl", size: 1074884, sha: "ff9476710e325f69548fb01f5e915671ba82dee1" },
      { path: "spot_micro_rviz/urdf/stl/frontpart.stl", size: 1056384, sha: "536217feea4e42fe854766beba5c0c53f29091b3" },
      { path: "spot_micro_rviz/urdf/stl/larm.stl", size: 579184, sha: "33e1ced4a0758369fd7d0e8836360ce43fdcaebb" },
      { path: "spot_micro_rviz/urdf/stl/larm_cover.stl", size: 356484, sha: "e9e79c0c784a85c7bd35dfc9684f85b6addb2f42" },
      { path: "spot_micro_rviz/urdf/stl/lfoot.stl", size: 325984, sha: "754105aeedd4f0b7086d91e47e4e4b142853ece1" },
      { path: "spot_micro_rviz/urdf/stl/lshoulder.stl", size: 635484, sha: "36e7893121d4a516ca0efa3ff8261db1906fd5ac" },
      { path: "spot_micro_rviz/urdf/stl/mainbody.stl", size: 1148484, sha: "448fe6ee5c89a29b2fcf21ccc1281b736b0c1c7c" },
      { path: "spot_micro_rviz/urdf/stl/rarm.stl", size: 579184, sha: "4fd1eb6bd801cb667eab66bb99e6d4a33dbac5f1" },
      { path: "spot_micro_rviz/urdf/stl/rarm_cover.stl", size: 356484, sha: "9b5a6e47d88e64f14dddfb13a0cec62c3d01be3f" },
      { path: "spot_micro_rviz/urdf/stl/rfoot.stl", size: 325984, sha: "8c4d3c5b903bd6c2480bc08e906705e29bb7a0c6" },
      { path: "spot_micro_rviz/urdf/stl/rshoulder.stl", size: 635484, sha: "20d7f6679fbe53f81c0fb098b5c8f98c8b82d534" },
    ],
  },
  "sawppy": {
    name: "Sawppy printed parts", repo: "Roger-random/Sawppy_Rover", commit: "16eccd0e2cf71d2c720fee56ba247d6d1238dbbb",
    files: [
      { path: "STL/Battery Tray.stl", size: 408984, sha: "ae8a616e8cbee7e96c754375ca633c6a6e49a40c" },
      { path: "STL/Body Corner.stl", size: 1116884, sha: "9baef7f395948b92df8b21a6220b93f06525d303" },
      { path: "STL/Bogie-Body.stl", size: 244184, sha: "737650a5b1bec23dc3abe868c0163091910b3e9b" },
      { path: "STL/Bogie-Wheels.stl", size: 674184, sha: "1ce7e684e73941d8da79e7309b4696bd2f586f77" },
      { path: "STL/Clip2n125.stl", size: 7284, sha: "a1a5565bfa5ca171460f9c05c1df6527f6df53f8" },
      { path: "STL/Clip3n20.stl", size: 7484, sha: "2796f3884c3a8d4197a2d202a4f974661095e5d5" },
      { path: "STL/DiffBrace.stl", size: 293484, sha: "2828321b4bf604bef3b5f8676b825d96e7de2d4d" },
      { path: "STL/DiffEnd.stl", size: 479084, sha: "168869bd79c68a4d2c373cca02aa26d4cd0e795a" },
      { path: "STL/DiffLink.stl", size: 182284, sha: "0f8580b351c8530f59d193faf986c56741c4465b" },
      { path: "STL/DiffLower.stl", size: 275784, sha: "83e5e31d24400fbc03c137ed84387a8ae8318eb2" },
      { path: "STL/DiffUpper.stl", size: 210484, sha: "c72b84f872e06306f017c8295525cba57cc5e970" },
      { path: "STL/Fixed Knuckle.stl", size: 459784, sha: "0dd1506cb20ae80be5843567ff35edeeae3c2987" },
      { path: "STL/Front Corner.stl", size: 779784, sha: "2e99bffcff5239f921dbd3158e4d7fcca67480b6" },
      { path: "STL/LX-16A - Bracket.stl", size: 122084, sha: "6f13752b6dba4fe59c7c05d7c339eea71ec5409b" },
      { path: "STL/LX-16A - Coupler.stl", size: 164084, sha: "23323ed6527d7d565ef6cd3faa3e51edf50daef0" },
      { path: "STL/Power Panel.stl", size: 167484, sha: "fce87a70b529e5ddecf5321d504edeb46b69ca19" },
      { path: "STL/Rear Corner.stl", size: 753184, sha: "b3e58fb33e7f278a8ef82a38f76b159d58abb714" },
      { path: "STL/Rocker Body Mount.stl", size: 654584, sha: "c6c9ceb68eb590ce45bef8433138e5b255926b8b" },
      { path: "STL/Rocker.stl", size: 950384, sha: "928a326d92f27fd5a91413d8be657ff5af09f43f" },
      { path: "STL/Rod Support.stl", size: 206784, sha: "f1a30fece82393f09c0e5c004556b1b6b8238b4f" },
      { path: "STL/Steering Knuckle.stl", size: 279084, sha: "e2fb3088cc352c87cd6f5f97c97f8340ae56079b" },
      { path: "STL/Wheel Hub.stl", size: 105784, sha: "b124076a5a10e116d30595a3ae29d8230b9342b8" },
      { path: "STL/Wheel.stl", size: 1309484, sha: "c9f3eef870ef53e9db4378aa1c02f4570ba6274c" },
    ],
  },
  "jpl-rover": {
    name: "rover mast parts", repo: "nasa-jpl/open-source-rover", commit: "49b40f127852f0315e675f4df8ad38259ec02927",
    files: [
      { path: "expansion/mast/3d_models/mast_backplate.stl", size: 116684, sha: "0c6315cff0c7c61bd21a993c369482f4c8dd87ed" },
      { path: "expansion/mast/3d_models/mast_head-2.stl", size: 512684, sha: "c1dd1c06dcfb503de7e25bac2f976697df52085c" },
    ],
  },
  "flix": {
    name: "Flix frame and holder", repo: "okalachev/flix", commit: "5f32af8cbfd2f2eb779914bc64bff9ed3e69a93b",
    files: [
      { path: "docs/assets/esp32-holder.stl", size: 126284, sha: "19d75a7d3d13790c960943c77192e100f8293ab1" },
      { path: "docs/assets/flix-frame-1.1.stl", size: 529484, sha: "480f942f58615c583b5ad1e6fcd11b7a44ed1f6f" },
      { path: "docs/assets/washer-m3.stl", size: 80684, sha: "5475fdbb823136a0b989697dc7e1b920c00a3a90" },
    ],
  },
  "dummy13-pla": {
    name: "Dummy 13 PLA files", repo: "flight-commander/dummy_13", commit: "98b908d27a9f30acafa359645b63392b791bb842",
    files: [
      { path: "Dummy_13_Scaled_GitHub.zip", size: 19082411, sha: "1b6eae5f19032426c99e6ca5ea1e35c852293fc9", unzip: ["Dummy_13_Scaled_GitHub/Dummy 13/01_Individual_Frame_Parts_STL/", "Dummy_13_Scaled_GitHub/Dummy 13/01_Individual_Armor_Parts_STL/", "Dummy_13_Scaled_GitHub/Dummy 13/Extras_STL/"] },
      { path: "Right-Hands-Dummy-13.zip", size: 2616085, sha: "994d09a0a51d5dd5db002e121b01d212d71b1237", unzip: ["Right-Hands-Dummy-13/"] },
    ],
  },
};

/** Total download size of a set, in bytes. */
export const remoteModelBytes = (m: RemoteModel) => m.files.reduce((sum, f) => sum + f.size, 0);
