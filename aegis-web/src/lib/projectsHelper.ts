import fs from "fs";
import path from "path";
import { ProjectDetail } from "./mockProjects";

const GALLERY_FOLDER_MAPPING: Record<string, { folder?: string; folders?: string[]; range?: [number, number] }> = {
  "SNC-MEGA-MARKET": { folders: ["mm_flour_mill_substation", "mm_retaining_walls", "mm_stormwater", "mm_transport_yard", "mm_transport_ablution"] },
  "SNC-HILLCREST": { folder: "hillcrest" },
  "SNC-SURREY": { folder: "surrey_pie_shop" },
  "SNC-TROUTBECK": { folder: "troutbeck" },
  "SNC-OTHER-CIVIL": { folders: ["other_civil", "padel_court", "private_renovations", "plant_equipment"] },
  "SNC-MM-TY": { folder: "mm_transport_yard" },
  "SNC-MM-TYA": { folder: "mm_transport_ablution" },
  "SNC-MM-SD": { folder: "mm_stormwater" },
  "SNC-MM-RW": { folder: "mm_retaining_walls" },
  "SNC-MM-WMC": { folder: "mm_flour_mill_substation" },
  "SNC-HC-BHB": { folder: "hillcrest" },
  "SNC-SURREY-PSR": { folder: "surrey_pie_shop" },
  "SNC-TB-TS": { folder: "troutbeck" },
  "SNC-AU-CP": { folder: "other_civil", range: [1, 5] },
  "SNC-GMS-DP": { folder: "other_civil", range: [6, 10] },
  "SNC-PC-PC": { folder: "padel_court" },
  "SNC-PR-RW": { folder: "private_renovations" },
  "SNC-MM-WH64": { folder: "mm_retaining_walls", range: [1, 15] },
  "SNC-MM-OBE": { folder: "mm_retaining_walls", range: [16, 25] },
};

export function getDynamicGalleryForId(id: string): string[] {
  const config = GALLERY_FOLDER_MAPPING[id];
  if (!config) return [];

  const folderNames = config.folders || (config.folder ? [config.folder] : []);
  try {
    const mapped = folderNames.flatMap((folderName) => {
      const dirPath = path.join(process.cwd(), "public", "projects_assets", folderName);
      if (!fs.existsSync(dirPath)) return [];
      return fs.readdirSync(dirPath)
        .filter((file) => /\.(webp|jpe?g)$/i.test(file))
        .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0))
        .map((file) => `/projects_assets/${folderName}/${file}`);
    });
    if (!config.range) return mapped;
    const [start, end] = config.range;
    return mapped.slice(start - 1, end);
  } catch (err) {
    console.error(`Error reading gallery for ${id}:`, err);
    return [];
  }
}

/**
 * Dynamically populates the galleries of a project and its subprojects
 */
export function populateProjectGalleries(project: any): any {
  if (!project) return project;

  const populated = { ...project };
  
  // Populate main project gallery if empty
  const mainGallery = getDynamicGalleryForId(populated.id);
  if (mainGallery.length > 0) {
    populated.gallery = mainGallery;
  } else if (!populated.gallery || populated.gallery.length === 0) {
    // Fallback to static hero
    populated.gallery = populated.featuredImage ? [populated.featuredImage] : [populated.image || "/proj-bridge.jpg"];
  }

  // Populate sub-projects galleries
  if (populated.subProjects && populated.subProjects.length > 0) {
    populated.subProjects = populated.subProjects.map((sp: any) => {
      const spGallery = getDynamicGalleryForId(sp.id);
      return {
        ...sp,
        gallery: spGallery.length > 0 ? spGallery : (sp.gallery || [])
      };
    });
  }

  return populated;
}
