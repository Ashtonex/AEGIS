import pypdf

def main():
    pdf_path = r"G:\work\ATMCAPPROJECTS\Mudekwa\AEGIS\SNC-HOUSE-500K-Complete-Construction-Pack 2 (1).pdf"
    try:
        reader = pypdf.PdfReader(pdf_path)
        num_pages = len(reader.pages)
        print(f"Total Pages: {num_pages}\n")
        
        for i in range(num_pages):
            text = reader.pages[i].extract_text()
            if not text:
                print(f"Page {i+1}: [Empty]")
                continue
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            print(f"Page {i+1}:")
            # print up to the first 5 non-header lines
            header_keywords = ["SIX NINE CONSTRUCTION", "SNC-HOUSE-500K", "Page", "Simulation only"]
            relevant_lines = []
            for l in lines:
                if not any(k in l for k in header_keywords):
                    relevant_lines.append(l)
                if len(relevant_lines) >= 4:
                    break
            for rl in relevant_lines:
                print(f"  - {rl[:100]}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
